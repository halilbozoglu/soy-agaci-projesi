import { DataManager } from './data-manager.js';
import { GraphRenderer } from './graph-renderer.js';
import { processImage } from './image-processor.js';

export class AppController {
    constructor() {
        this.dataManager = new DataManager();
        this.currentBase64Image = null;
        this.editingPersonId = null;

        this.renderer = new GraphRenderer('graph-container', {
            edit: (person) => this.enterEditMode(person),
            addParent: (person, ev) => this.addParentFor(person, ev),
            addChild: (person, ev) => this.addChildFor(person, ev),
            addSibling: (person, ev) => this.addSiblingFor(person, ev),
            addPartner: (person, ev) => this.addPartnerFor(person, ev),
            delete: (person) => this.deletePersonWithConfirm(person),
            onDragEnd: (personId, ox, oy) => this.saveOffset(personId, ox, oy),
            _setLastEvent: (ev) => { this._lastContextEvent = ev; },
            // FSM Linking
            startLinkingFSM: (person, action, ev) => this.startLinkingFSM(person, action, ev),
            onLinkingComplete: (p1, p2, state, unionId) => this.onLinkingComplete(p1, p2, state, unionId)
        });
    }

    init() {
        this.bindEvents();
        this.updateDatalist();
        this.render();
    }

    render() {
        this.renderer.render(this.dataManager);
        this.updateDatalist();
    }

    updateDatalist() {
        const datalist = document.getElementById('person-list');
        datalist.innerHTML = '';
        this.dataManager.data.persons.forEach(p => {
            const option = document.createElement('option');
            option.value = `${p.ad} ${p.soyad} (${p.id})`; 
            datalist.appendChild(option);
        });
    }

    _generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    }

    // ============================================================
    // FSM LINKING: Context Menu'den mod başlatma
    // ============================================================
    startLinkingFSM(person, action, event) {
        const ev = event || this._lastContextEvent || { clientX: 400, clientY: 300 };

        if (action === 'startLinkSpouse') {
            this.renderer.enterLinkingMode(person, 'SPOUSE');
        }
        else if (action === 'startLinkChild') {
            // Kişinin birden fazla union'ı varsa seçtir
            const unions = this.dataManager.getUnionsForPerson(person.id);
            if (unions.length > 1) {
                const unionOpts = unions.map(u => {
                    const others = u.partnerIds.filter(pid => pid !== person.id)
                        .map(pid => { const p = this.dataManager.getPerson(pid); return p ? `${p.ad} ${p.soyad}` : '?'; }).join(', ');
                    return { id: u.id, label: others || 'Tek ebeveyn' };
                });
                // Mini popover ile union seç
                this.showPopover(ev, `🔗 Hangi birlikteliğe çocuk yapılacak?`, (formData) => {
                    this.renderer.enterLinkingMode(person, 'CHILD', formData.selectedUnionId);
                }, {}, { unionSelectOnly: true, unionSelect: unionOpts });
            } else if (unions.length === 1) {
                this.renderer.enterLinkingMode(person, 'CHILD', unions[0].id);
            } else {
                // Union yok, yeni oluşturulacak
                this.renderer.enterLinkingMode(person, 'CHILD', null);
            }
        }
        else if (action === 'startLinkSibling') {
            const parentUnion = this.dataManager.getParentUnion(person.id);
            this.renderer.enterLinkingMode(person, 'SIBLING', parentUnion ? parentUnion.id : null);
        }
    }

    // FSM Linking tamamlandığında: state'e göre atomik işlem yap
    onLinkingComplete(firstPerson, secondPerson, state, targetUnionId) {
        // Cycle check (tüm modlar için)
        if (state === 'SPOUSE') {
            if (this.dataManager.wouldCreateCycle(firstPerson.id, secondPerson.id)) {
                this.renderer.showToast('🚫 Mantıksal Hata: Soy çizgisinde paradoks! Bu evlilik döngü yaratır.', 'error');
                return;
            }
            this.dataManager.pushHistory();
            try {
                this.dataManager.data.unions.push({
                    id: this._generateId(),
                    partnerIds: [firstPerson.id, secondPerson.id],
                    childrenIds: []
                });
                this.dataManager.save();
                this.render();
            } catch (e) { console.error(e); this.dataManager.undo(); }
        }
        else if (state === 'CHILD') {
            // Cycle check: firstPerson çocuğu olarak secondPerson eklenecek
            if (this.dataManager.hasCycle(secondPerson.id, firstPerson.id)) {
                this.renderer.showToast('🚫 Mantıksal Hata: Bu kişiyi çocuk yapmak döngü yaratır!', 'error');
                return;
            }
            this.dataManager.pushHistory();
            try {
                if (targetUnionId) {
                    const union = this.dataManager.getUnion(targetUnionId);
                    if (union && !union.childrenIds.includes(secondPerson.id)) {
                        union.childrenIds.push(secondPerson.id);
                    }
                } else {
                    this.dataManager.data.unions.push({
                        id: this._generateId(),
                        partnerIds: [firstPerson.id],
                        childrenIds: [secondPerson.id]
                    });
                }
                this.dataManager.save();
                this.render();
            } catch (e) { console.error(e); this.dataManager.undo(); }
        }
        else if (state === 'SIBLING') {
            this.dataManager.pushHistory();
            try {
                if (targetUnionId) {
                    const union = this.dataManager.getUnion(targetUnionId);
                    if (union && !union.childrenIds.includes(secondPerson.id)) {
                        union.childrenIds.push(secondPerson.id);
                    }
                } else {
                    // Ebeveyn birliği yoksa yeni görünmez Union oluştur
                    this.dataManager.data.unions.push({
                        id: this._generateId(),
                        partnerIds: [],
                        childrenIds: [firstPerson.id, secondPerson.id]
                    });
                }
                this.dataManager.save();
                this.render();
            } catch (e) { console.error(e); this.dataManager.undo(); }
        }
    }

    // ============================================================
    // POPOVER MODAL SİSTEMİ
    // ============================================================
    destroyPopover() {
        const existing = document.getElementById('inline-popover');
        if (existing) existing.remove();
    }

    showPopover(event, title, onSubmit, defaults = {}, options = {}) {
        this.destroyPopover();

        const container = document.getElementById('graph-container');
        const containerRect = container.getBoundingClientRect();

        const popover = document.createElement('div');
        popover.id = 'inline-popover';
        popover.className = 'popover-modal';

        let unionSelectHtml = '';
        if (options.unionSelect && options.unionSelect.length > 0) {
            const opts = options.unionSelect.map(u => `<option value="${u.id}">${u.label}</option>`).join('');
            unionSelectHtml = `
                <label class="popover-label">Hangi birliktelikten?</label>
                <select id="pop-union-select" class="form-input">${opts}</select>
            `;
        }

        const batchHint = options.batchMode ? ' (virgülle ayırarak birden fazla)' : '';

        // unionSelectOnly modunda sadece union seçici göster
        let formFieldsHtml = '';
        if (!options.unionSelectOnly) {
            formFieldsHtml = `
                <input type="text" id="pop-ad" placeholder="Ad${batchHint}" required class="form-input" value="${defaults.ad || ''}" />
                <input type="text" id="pop-soyad" placeholder="Soyad" class="form-input" value="${defaults.soyad || ''}" />
                <select id="pop-cinsiyet" class="form-input">
                    <option value="Erkek" ${defaults.cinsiyet === 'Erkek' ? 'selected' : ''}>Erkek</option>
                    <option value="Kadın" ${defaults.cinsiyet === 'Kadın' ? 'selected' : ''}>Kadın</option>
                    <option value="Belirtilmemiş" ${(!defaults.cinsiyet || defaults.cinsiyet === 'Belirtilmemiş') ? 'selected' : ''}>Belirtilmemiş</option>
                </select>
                <input type="text" id="pop-tarih" placeholder="Doğum Tarihi" class="form-input" value="${defaults.dogumTarihi || ''}" />
            `;
        }

        const submitLabel = options.unionSelectOnly ? 'Seç ve Devam Et' : 'Ekle ve Bağla';

        popover.innerHTML = `
            <div class="popover-header">
                <span class="popover-title">${title}</span>
                <button class="popover-close" id="popover-close-btn">✕</button>
            </div>
            <form id="popover-form" class="popover-body">
                ${unionSelectHtml}
                ${formFieldsHtml}
                <div class="popover-actions">
                    <button type="submit" class="popover-btn-submit">${submitLabel}</button>
                    <button type="button" class="popover-btn-cancel" id="popover-cancel-btn">İptal</button>
                </div>
            </form>
        `;

        container.appendChild(popover);

        let left = event.clientX - containerRect.left + 15;
        let top = event.clientY - containerRect.top + 15;
        if (left + 280 > containerRect.width) left = left - 300;
        if (top + 360 > containerRect.height) top = Math.max(10, top - 380);
        popover.style.left = `${left}px`;
        popover.style.top = `${top}px`;

        const closePopover = () => this.destroyPopover();
        popover.querySelector('#popover-close-btn').addEventListener('click', (e) => { e.stopPropagation(); closePopover(); });
        popover.querySelector('#popover-cancel-btn').addEventListener('click', (e) => { e.stopPropagation(); closePopover(); });
        popover.addEventListener('click', (e) => e.stopPropagation());

        popover.querySelector('#popover-form').addEventListener('submit', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const formData = {
                ad: '', soyad: '', cinsiyet: 'Belirtilmemiş', dogumTarihi: '',
                selectedUnionId: null
            };
            const adEl = popover.querySelector('#pop-ad');
            if (adEl) formData.ad = adEl.value;
            const soyadEl = popover.querySelector('#pop-soyad');
            if (soyadEl) formData.soyad = soyadEl.value;
            const cinsiyetEl = popover.querySelector('#pop-cinsiyet');
            if (cinsiyetEl) formData.cinsiyet = cinsiyetEl.value;
            const tarihEl = popover.querySelector('#pop-tarih');
            if (tarihEl) formData.dogumTarihi = tarihEl.value;
            const unionEl = popover.querySelector('#pop-union-select');
            if (unionEl) formData.selectedUnionId = unionEl.value;
            closePopover();
            onSubmit(formData);
        });

        const firstInput = popover.querySelector('#pop-ad') || popover.querySelector('#pop-union-select');
        if (firstInput) setTimeout(() => firstInput.focus(), 50);
    }

    // ============================================================
    // DÜZENLEME MODU
    // ============================================================
    enterEditMode(person) {
        this.editingPersonId = person.id;
        document.getElementById('p-ad').value = person.ad || '';
        document.getElementById('p-soyad').value = person.soyad || '';
        document.getElementById('p-cinsiyet').value = person.cinsiyet || 'Belirtilmemiş';
        document.getElementById('p-tarih').value = person.dogumTarihi || '';
        document.getElementById('p-yakinlik').value = person.yakinlikDerecesi || '';
        if (person.fotograf) {
            this.currentBase64Image = person.fotograf;
            const imgPreview = document.getElementById('img-preview');
            const previewContainer = document.getElementById('preview-container');
            imgPreview.src = person.fotograf;
            previewContainer.classList.remove('hidden');
            previewContainer.classList.add('flex');
        }
        const submitBtn = document.getElementById('btn-submit-person');
        const formTitle = document.getElementById('form-person-title');
        submitBtn.textContent = 'Kişiyi Güncelle';
        submitBtn.classList.remove('btn-primary');
        submitBtn.classList.add('btn-edit-mode');
        formTitle.textContent = '✏️ Kişiyi Düzenle';
        document.getElementById('btn-cancel-edit').classList.remove('hidden');
        document.getElementById('p-ad').focus();
    }

    exitEditMode() {
        this.editingPersonId = null;
        document.getElementById('form-person').reset();
        this.currentBase64Image = null;
        const previewContainer = document.getElementById('preview-container');
        previewContainer.classList.add('hidden');
        previewContainer.classList.remove('flex');
        const submitBtn = document.getElementById('btn-submit-person');
        const formTitle = document.getElementById('form-person-title');
        submitBtn.textContent = 'Kişiyi Oluştur';
        submitBtn.classList.remove('btn-edit-mode');
        submitBtn.classList.add('btn-primary');
        formTitle.textContent = 'Yeni Kişi Ekle';
        document.getElementById('btn-cancel-edit').classList.add('hidden');
    }

    deletePersonWithConfirm(person) {
        if (confirm(`"${person.ad} ${person.soyad}" kişisini silmek istediğinize emin misiniz?`)) {
            this.dataManager.deletePerson(person.id);
            this.render();
        }
    }

    // ============================================================
    // POPOVER TABANLI EKLEME FONKSİYONLARI
    // ============================================================
    addParentFor(person, event) {
        const ev = event || this._lastContextEvent || { clientX: 400, clientY: 300 };
        this.showPopover(ev, `👨 "${person.ad}" için Baba Ekle`, (babaData) => {
            this.showPopover(ev, `👩 "${person.ad}" için Anne Ekle`, (anneData) => {
                this._commitParents(person, babaData, anneData);
            }, { cinsiyet: 'Kadın' });
        }, { cinsiyet: 'Erkek' });
    }

    _commitParents(person, babaData, anneData) {
        this.dataManager.pushHistory();
        try {
            const partnerIds = [];
            if (babaData && babaData.ad.trim() !== '') {
                const id = this._generateId();
                this.dataManager.data.persons.push({
                    id, ad: babaData.ad, soyad: babaData.soyad || '',
                    cinsiyet: 'Erkek', dogumTarihi: babaData.dogumTarihi || '',
                    yakinlikDerecesi: 'Baba', fotograf: null, offsetX: 0, offsetY: 0
                });
                partnerIds.push(id);
            }
            if (anneData && anneData.ad.trim() !== '') {
                const id = this._generateId() + 'a';
                this.dataManager.data.persons.push({
                    id, ad: anneData.ad, soyad: anneData.soyad || '',
                    cinsiyet: 'Kadın', dogumTarihi: anneData.dogumTarihi || '',
                    yakinlikDerecesi: 'Anne', fotograf: null, offsetX: 0, offsetY: 0
                });
                partnerIds.push(id);
            }
            if (partnerIds.length > 0) {
                this.dataManager.data.unions.push({
                    id: this._generateId(),
                    partnerIds: [...new Set(partnerIds)],
                    childrenIds: [person.id]
                });
            }
            this.dataManager.save();
            this.render();
        } catch (error) { console.error("Ebeveyn hatası:", error); this.dataManager.undo(); }
    }

    addPartnerFor(person, event) {
        const ev = event || this._lastContextEvent || { clientX: 400, clientY: 300 };
        this.showPopover(ev, `💍 "${person.ad}" için Eş/Partner Ekle`, (formData) => {
            if (!formData.ad || formData.ad.trim() === '') return;
            this.dataManager.pushHistory();
            try {
                const id = this._generateId();
                this.dataManager.data.persons.push({
                    id, ad: formData.ad, soyad: formData.soyad || '',
                    cinsiyet: formData.cinsiyet, dogumTarihi: formData.dogumTarihi || '',
                    yakinlikDerecesi: 'Eş', fotograf: null, offsetX: 0, offsetY: 0
                });
                this.dataManager.data.unions.push({
                    id: this._generateId(),
                    partnerIds: [person.id, id],
                    childrenIds: []
                });
                this.dataManager.save();
                this.render();
            } catch (e) { console.error(e); this.dataManager.undo(); }
        });
    }

    addChildFor(person, event) {
        const ev = event || this._lastContextEvent || { clientX: 400, clientY: 300 };
        const unions = this.dataManager.getUnionsForPerson(person.id);

        let unionSelectOpts = null;
        if (unions.length > 1) {
            unionSelectOpts = unions.map(u => {
                const others = u.partnerIds.filter(pid => pid !== person.id)
                    .map(pid => { const p = this.dataManager.getPerson(pid); return p ? `${p.ad} ${p.soyad}` : '?'; }).join(', ');
                return { id: u.id, label: others || 'Tek ebeveyn' };
            });
        }

        this.showPopover(ev, `👶 "${person.ad}" için Çocuk Ekle`, (formData) => {
            if (!formData.ad || formData.ad.trim() === '') return;
            const names = formData.ad.split(',').map(n => n.trim()).filter(n => n !== '');
            this.dataManager.pushHistory();
            try {
                const childIds = [];
                names.forEach(name => {
                    const id = this._generateId();
                    this.dataManager.data.persons.push({
                        id, ad: name, soyad: formData.soyad || '',
                        cinsiyet: formData.cinsiyet, dogumTarihi: formData.dogumTarihi || '',
                        yakinlikDerecesi: 'Çocuk', fotograf: null, offsetX: 0, offsetY: 0
                    });
                    childIds.push(id);
                });
                let targetUnion = null;
                if (formData.selectedUnionId) targetUnion = this.dataManager.getUnion(formData.selectedUnionId);
                else if (unions.length === 1) targetUnion = unions[0];

                if (targetUnion) {
                    childIds.forEach(cid => targetUnion.childrenIds.push(cid));
                } else {
                    this.dataManager.data.unions.push({
                        id: this._generateId(),
                        partnerIds: [person.id],
                        childrenIds: childIds
                    });
                }
                this.dataManager.save();
                this.render();
            } catch (e) { console.error(e); this.dataManager.undo(); }
        }, {}, { batchMode: true, unionSelect: unionSelectOpts });
    }

    addSiblingFor(person, event) {
        const ev = event || this._lastContextEvent || { clientX: 400, clientY: 300 };
        this.showPopover(ev, `🧑‍🤝‍🧑 "${person.ad}" için Kardeş Ekle`, (formData) => {
            if (!formData.ad || formData.ad.trim() === '') return;
            const names = formData.ad.split(',').map(n => n.trim()).filter(n => n !== '');
            this.dataManager.pushHistory();
            try {
                const siblingIds = [];
                names.forEach(name => {
                    const id = this._generateId();
                    this.dataManager.data.persons.push({
                        id, ad: name, soyad: formData.soyad || '',
                        cinsiyet: formData.cinsiyet, dogumTarihi: formData.dogumTarihi || '',
                        yakinlikDerecesi: 'Kardeş', fotograf: null, offsetX: 0, offsetY: 0
                    });
                    siblingIds.push(id);
                });
                const parentUnion = this.dataManager.getParentUnion(person.id);
                if (parentUnion) {
                    siblingIds.forEach(sid => parentUnion.childrenIds.push(sid));
                } else {
                    this.dataManager.data.unions.push({
                        id: this._generateId(),
                        partnerIds: [],
                        childrenIds: [person.id, ...siblingIds]
                    });
                }
                this.dataManager.save();
                this.render();
            } catch (e) { console.error(e); this.dataManager.undo(); }
        }, {}, { batchMode: true });
    }

    saveOffset(personId, ox, oy) {
        const person = this.dataManager.getPerson(personId);
        if (person) {
            person.offsetX = ox;
            person.offsetY = oy;
            this.dataManager.save();
        }
    }

    // ============================================================
    // GLOBAL EVENT BINDING
    // ============================================================
    bindEvents() {
        const dropZone = document.getElementById('drop-zone');
        const fileInput = document.getElementById('p-foto');
        const previewContainer = document.getElementById('preview-container');
        const imgPreview = document.getElementById('img-preview');

        dropZone.addEventListener('click', () => fileInput.click());
        dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('bg-slate-100'); });
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('bg-slate-100'));

        const handleFile = async (file) => {
            if (file) {
                try {
                    this.currentBase64Image = await processImage(file);
                    imgPreview.src = this.currentBase64Image;
                    previewContainer.classList.remove('hidden');
                    previewContainer.classList.add('flex');
                } catch (err) { alert(err.message); }
            }
        };

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('bg-slate-100');
            handleFile(e.dataTransfer.files[0]);
        });
        fileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));

        document.getElementById('form-person').addEventListener('submit', (e) => {
            e.preventDefault();
            if (this.editingPersonId) {
                const updates = {
                    ad: document.getElementById('p-ad').value,
                    soyad: document.getElementById('p-soyad').value,
                    cinsiyet: document.getElementById('p-cinsiyet').value,
                    dogumTarihi: document.getElementById('p-tarih').value,
                    yakinlikDerecesi: document.getElementById('p-yakinlik').value,
                    fotograf: this.currentBase64Image
                };
                this.dataManager.updatePerson(this.editingPersonId, updates);
                this.exitEditMode();
                this.render();
            } else {
                const newPerson = {
                    id: this._generateId(),
                    ad: document.getElementById('p-ad').value,
                    soyad: document.getElementById('p-soyad').value,
                    cinsiyet: document.getElementById('p-cinsiyet').value,
                    dogumTarihi: document.getElementById('p-tarih').value,
                    yakinlikDerecesi: document.getElementById('p-yakinlik').value,
                    fotograf: this.currentBase64Image,
                    offsetX: 0, offsetY: 0
                };
                this.dataManager.addPerson(newPerson);
                this.render();
                e.target.reset();
                this.currentBase64Image = null;
                previewContainer.classList.add('hidden');
                previewContainer.classList.remove('flex');
            }
        });

        document.getElementById('btn-cancel-edit').addEventListener('click', () => this.exitEditMode());

        document.getElementById('form-union').addEventListener('submit', (e) => {
            e.preventDefault();
            const p1Val = document.getElementById('u-partner1').value;
            const p2Val = document.getElementById('u-partner2').value;
            const childVal = document.getElementById('u-children').value;
            this.dataManager.pushHistory();
            try {
                const partnerIds = [];
                const childrenIds = [];
                const processInput = (val, arr) => {
                    if (!val || val.trim() === '') return;
                    const match = val.match(/\((.*?)\)$/);
                    const id = match ? match[1] : null;
                    if (id && this.dataManager.getPerson(id)) { arr.push(id); }
                    else {
                        const parts = val.trim().split(' ');
                        const soyad = parts.length > 1 ? parts.pop() : '';
                        const ad = parts.join(' ') || val.trim();
                        const newId = this._generateId();
                        this.dataManager.data.persons.push({
                            id: newId, ad, soyad, cinsiyet: 'Belirtilmemiş',
                            dogumTarihi: '', yakinlikDerecesi: 'Otomatik Eklendi',
                            fotograf: null, offsetX: 0, offsetY: 0
                        });
                        arr.push(newId);
                    }
                };
                processInput(p1Val, partnerIds);
                processInput(p2Val, partnerIds);
                if (childVal && childVal.trim() !== '') {
                    childVal.split(',').map(s => s.trim()).forEach(cv => processInput(cv, childrenIds));
                }
                if (partnerIds.length > 0 || childrenIds.length > 0) {
                    this.dataManager.data.unions.push({
                        id: this._generateId(),
                        partnerIds: [...new Set(partnerIds)],
                        childrenIds: [...new Set(childrenIds)]
                    });
                }
                this.dataManager.save();
                this.render();
                e.target.reset();
            } catch (error) {
                console.error("Batch Transaction Hatası:", error);
                this.dataManager.undo();
                alert("İşlem sırasında hata oluştu, geri alındı.");
            }
        });

        document.getElementById('btn-undo').addEventListener('click', () => {
            if (this.dataManager.undo()) { this.render(); }
            else { alert("Geri alınabilecek işlem yok."); }
        });

        document.getElementById('btn-clear').addEventListener('click', () => {
            if (confirm("Tüm veriyi silmek istediğinize emin misiniz?")) {
                this.dataManager.clearAllData();
                this.render();
            }
        });

        document.getElementById('btn-auto-layout').addEventListener('click', () => {
            this.dataManager.resetAllOffsets();
            this.render();
        });
    }
}
