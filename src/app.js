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
            onDragEnd: (id, ox, oy, nodeType) => this.saveOffset(id, ox, oy, nodeType),
            _setLastEvent: (ev) => { this._lastContextEvent = ev; },
            // FSM Linking
            startLinkingFSM: (person, action, ev) => this.startLinkingFSM(person, action, ev),
            onLinkingComplete: (p1, p2, state, unionId) => this.onLinkingComplete(p1, p2, state, unionId),
            onEditParentsComplete: (child, parents) => this.onEditParentsComplete(child, parents),
            onMergeComplete: (source, target) => this.onMergeComplete(source, target),
            toggleDivorced: (unionId) => { this.dataManager.toggleDivorced(unionId); this.render(); }
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
        // Reaktif form görünürlüğü: Sadece ağaç boşken görünsün
        const formCard = document.getElementById('person-form-card');
        if (formCard) {
            if (this.dataManager.data.persons.length > 0 && !this.editingPersonId) {
                formCard.style.display = 'none';
            } else {
                formCard.style.display = '';
            }
        }
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

    // Title Case: Her kelimenin ilk harfi büyük
    _toTitleCase(str) {
        if (!str) return '';
        return str.trim().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
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

        let formFieldsHtml = '';
        if (!options.unionSelectOnly) {
            formFieldsHtml = `
                <input type="text" id="pop-ad" placeholder="Ad${batchHint}" required class="form-input" value="${defaults.ad || ''}" />
                <input type="text" id="pop-soyad" placeholder="Soyad" class="form-input" value="${defaults.soyad || ''}" />
                <select id="pop-cinsiyet" class="form-input" ${options.lockGender ? 'disabled' : ''}>
                    <option value="Erkek" ${defaults.cinsiyet === 'Erkek' ? 'selected' : ''}>Erkek</option>
                    <option value="Kadın" ${defaults.cinsiyet === 'Kadın' ? 'selected' : ''}>Kadın</option>
                    <option value="Belirtilmemiş" ${(!defaults.cinsiyet || defaults.cinsiyet === 'Belirtilmemiş') ? 'selected' : ''}>Belirtilmemiş</option>
                </select>
                <input type="text" id="pop-tarih" placeholder="Doğum Tarihi" class="form-input" value="${defaults.dogumTarihi || ''}" />
                <label class="flex items-center gap-2 text-xs text-slate-300 mt-1 cursor-pointer"><input type="checkbox" id="pop-deceased" ${defaults.isDeceased ? 'checked' : ''} class="rounded"/> 🖤 Vefat Etti</label>
                <input type="text" id="pop-olum-tarihi" placeholder="Ölüm Tarihi" class="form-input" value="${defaults.olumTarihi || ''}" style="${defaults.isDeceased ? 'display:block; margin-top:8px;' : 'display:none; margin-top:8px;'}" />
            `;
        }

        const submitLabel = options.editMode ? 'Güncelle' : (options.unionSelectOnly ? 'Seç ve Devam Et' : 'Ekle ve Bağla');

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
        const closeBtn = popover.querySelector('#popover-close-btn');
        if (closeBtn) closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closePopover(); });
        const cancelBtn = popover.querySelector('#popover-cancel-btn');
        if (cancelBtn) cancelBtn.addEventListener('click', (e) => { e.stopPropagation(); closePopover(); });
        popover.addEventListener('click', (e) => e.stopPropagation());

        const deceasedEl = popover.querySelector('#pop-deceased');
        const olumEl = popover.querySelector('#pop-olum-tarihi');
        if (deceasedEl && olumEl) {
            deceasedEl.addEventListener('change', (e) => {
                olumEl.style.display = e.target.checked ? 'block' : 'none';
            });
        }

        popover.querySelector('#popover-form').addEventListener('submit', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const formData = {
                ad: '', soyad: '', cinsiyet: 'Belirtilmemiş', dogumTarihi: '', yakinlikDerecesi: '',
                selectedUnionId: null
            };
            const adEl = popover.querySelector('#pop-ad');
            if (adEl) formData.ad = adEl.value;
            const soyadEl = popover.querySelector('#pop-soyad');
            if (soyadEl) formData.soyad = soyadEl.value;
            const cinsiyetEl = popover.querySelector('#pop-cinsiyet');
            if (cinsiyetEl) formData.cinsiyet = cinsiyetEl.disabled ? (defaults.cinsiyet || cinsiyetEl.value) : cinsiyetEl.value;
            const tarihEl = popover.querySelector('#pop-tarih');
            if (tarihEl) formData.dogumTarihi = tarihEl.value;
            const yakinlikEl = popover.querySelector('#pop-yakinlik');
            if (yakinlikEl && !options.unionSelectOnly) formData.yakinlikDerecesi = yakinlikEl.value;
            const deceasedElCheck = popover.querySelector('#pop-deceased');
            if (deceasedElCheck && !options.unionSelectOnly) formData.isDeceased = deceasedElCheck.checked;
            const olumElCheck = popover.querySelector('#pop-olum-tarihi');
            if (olumElCheck && formData.isDeceased && !options.unionSelectOnly) formData.olumTarihi = olumElCheck.value;
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
    enterEditMode(person, event) {
        const ev = event || this._lastContextEvent || { clientX: 400, clientY: 300 };
        this.showPopover(ev, `✏️ "${person.ad} ${person.soyad}" Düzenle`, (formData) => {
            if (!formData.ad || formData.ad.trim() === '') return;
            const updates = {
                ad: this._toTitleCase(formData.ad),
                soyad: this._toTitleCase(formData.soyad),
                cinsiyet: formData.cinsiyet,
                dogumTarihi: formData.dogumTarihi,
                olumTarihi: formData.olumTarihi || '',
                yakinlikDerecesi: formData.yakinlikDerecesi,
                isDeceased: formData.isDeceased || false
            };
            this.dataManager.updatePerson(person.id, updates);
            this.render();
        }, {
            ad: person.ad,
            soyad: person.soyad,
            cinsiyet: person.cinsiyet,
            dogumTarihi: person.dogumTarihi,
            olumTarihi: person.olumTarihi,
            yakinlikDerecesi: person.yakinlikDerecesi,
            isDeceased: person.isDeceased
        }, { editMode: true });
    }

    // ============================================================
    // KİŞİ BİRLEŞTİRME (VERTEX MERGING)
    // ============================================================
    onMergeComplete(source, target) {
        if (confirm(`"${source.ad} ${source.soyad}" kişisini "${target.ad} ${target.soyad}" ile birleştirmek istediğinize emin misiniz?\n\nKaynak kişi silinecek, tüm bağlantıları hedefe aktarılacaktır.`)) {
            this.dataManager.mergePersons(source.id, target.id);
            this.render();
            this.renderer.showToast(`✅ "${source.ad}" → "${target.ad}" başarıyla birleştirildi.`, 'success');
        }
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
            const newPartnerIds = [];
            if (babaData && babaData.ad.trim() !== '') {
                const id = this._generateId();
                this.dataManager.data.persons.push({
                    id, ad: babaData.ad, soyad: babaData.soyad || '',
                    cinsiyet: 'Erkek', dogumTarihi: babaData.dogumTarihi || '', olumTarihi: babaData.olumTarihi || '',
                    yakinlikDerecesi: babaData.yakinlikDerecesi || '', fotograf: null, offsetX: 0, offsetY: 0, isDeceased: babaData.isDeceased || false
                });
                newPartnerIds.push(id);
            }
            if (anneData && anneData.ad.trim() !== '') {
                const id = this._generateId() + 'a';
                this.dataManager.data.persons.push({
                    id, ad: anneData.ad, soyad: anneData.soyad || '',
                    cinsiyet: 'Kadın', dogumTarihi: anneData.dogumTarihi || '', olumTarihi: anneData.olumTarihi || '',
                    yakinlikDerecesi: anneData.yakinlikDerecesi || '', fotograf: null, offsetX: 0, offsetY: 0, isDeceased: anneData.isDeceased || false
                });
                newPartnerIds.push(id);
            }
            if (newPartnerIds.length > 0) {
                // DEDUP: Kişinin zaten child olarak bağlı olduğu bir Union varsa kullan
                const existingParentUnion = this.dataManager.getParentUnion(person.id);
                if (existingParentUnion) {
                    // Mevcut union'a partner olarak ekle (duplikasyon önle)
                    newPartnerIds.forEach(pid => {
                        if (!existingParentUnion.partnerIds.includes(pid)) {
                            existingParentUnion.partnerIds.push(pid);
                        }
                    });
                } else {
                    // Yeni Union oluştur
                    this.dataManager.data.unions.push({
                        id: this._generateId(),
                        partnerIds: [...new Set(newPartnerIds)],
                        childrenIds: [person.id]
                    });
                }
            }
            this.dataManager.save();
            this.render();
        } catch (error) { console.error("Ebeveyn hatası:", error); this.dataManager.undo(); }
    }

    addPartnerFor(person, event) {
        const ev = event || this._lastContextEvent || { clientX: 400, clientY: 300 };
        // Otomatik Eş Cinsiyet Tespiti: asıl kişinin cinsiyetinin tersini varsayılan yap
        const oppositeGender = person.cinsiyet === 'Erkek' ? 'Kadın' : (person.cinsiyet === 'Kadın' ? 'Erkek' : 'Belirtilmemiş');
        this.showPopover(ev, `💍 "${person.ad}" için Eş/Partner Ekle`, (formData) => {
            if (!formData.ad || formData.ad.trim() === '') return;
            this.dataManager.pushHistory();
            try {
                const id = this._generateId();
                this.dataManager.data.persons.push({
                    id, ad: this._toTitleCase(formData.ad), soyad: this._toTitleCase(formData.soyad || ''),
                    cinsiyet: formData.cinsiyet, dogumTarihi: formData.dogumTarihi || '', olumTarihi: formData.olumTarihi || '',
                    yakinlikDerecesi: formData.yakinlikDerecesi || '', fotograf: null, offsetX: 0, offsetY: 0,
                    isDeceased: formData.isDeceased || false
                });
                this.dataManager.data.unions.push({
                    id: this._generateId(),
                    partnerIds: [person.id, id],
                    childrenIds: [],
                    isDivorced: false, offsetX: 0, offsetY: 0
                });
                this.dataManager.save();
                this.render();
            } catch (e) { console.error(e); this.dataManager.undo(); }
        }, { cinsiyet: oppositeGender }, { lockGender: true });
    }

    addChildFor(person, event) {
        const ev = event || this._lastContextEvent || { clientX: 400, clientY: 300 };
        const unions = this.dataManager.getUnionsForPerson(person.id);

        // Çoklu evlilik: Union seçimi ZORUNLU
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

            // Çoklu evlilikte union seçimi zorunluyken seçim yapılmadıysa uyar
            if (unions.length > 1 && !formData.selectedUnionId) {
                this.renderer.showToast('⚠️ Birden fazla evlilik var, union seçimi zorunlu!', 'error');
                return;
            }

            const names = formData.ad.split(',').map(n => n.trim()).filter(n => n !== '');
            this.dataManager.pushHistory();
            try {
                const childIds = [];
                names.forEach(name => {
                    const id = this._generateId();
                    this.dataManager.data.persons.push({
                        id, ad: name, soyad: formData.soyad || '',
                        cinsiyet: formData.cinsiyet, dogumTarihi: formData.dogumTarihi || '',
                        yakinlikDerecesi: '', fotograf: null, offsetX: 0, offsetY: 0
                    });
                    childIds.push(id);
                });
                let targetUnion = null;
                if (formData.selectedUnionId) targetUnion = this.dataManager.getUnion(formData.selectedUnionId);
                else if (unions.length === 1) targetUnion = unions[0];

                if (targetUnion) {
                    childIds.forEach(cid => targetUnion.childrenIds.push(cid));
                } else {
                    // Union yoksa yeni oluştur
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
                        yakinlikDerecesi: '', fotograf: null, offsetX: 0, offsetY: 0
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

    saveOffset(id, ox, oy, nodeType) {
        if (nodeType === 'union') {
            const union = this.dataManager.getUnion(id);
            if (union) {
                union.offsetX = ox;
                union.offsetY = oy;
                this.dataManager.save();
            }
        } else {
            const person = this.dataManager.getPerson(id);
            if (person) {
                person.offsetX = ox;
                person.offsetY = oy;
                this.dataManager.save();
            }
        }
    }

    // ============================================================
    // RE-PARENTING: Ebeveyn değiştirme tamamlandığında
    // ============================================================
    onEditParentsComplete(child, parents) {
        const newParentIds = parents.map(p => p.id);
        // Cycle check
        for (const pid of newParentIds) {
            if (this.dataManager.hasCycle(child.id, pid)) {
                this.renderer.showToast('🚫 Mantıksal Hata: Bu ebeveyn ataması döngü yaratır!', 'error');
                return;
            }
        }
        this.dataManager.reparentChild(child.id, newParentIds);
        this.render();
        this.renderer.showToast(`✅ "${child.ad}" için ebeveynler değiştirildi.`, 'success');
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
                    ad: this._toTitleCase(document.getElementById('p-ad').value),
                    soyad: this._toTitleCase(document.getElementById('p-soyad').value),
                    cinsiyet: document.getElementById('p-cinsiyet').value,
                    dogumTarihi: document.getElementById('p-tarih').value,
                    olumTarihi: document.getElementById('p-olum-tarihi') ? document.getElementById('p-olum-tarihi').value : '',
                    isDeceased: document.getElementById('p-deceased') ? document.getElementById('p-deceased').checked : false,
                    yakinlikDerecesi: document.getElementById('p-yakinlik').value,
                    fotograf: this.currentBase64Image
                };
                this.dataManager.updatePerson(this.editingPersonId, updates);
                this.editingPersonId = null;
                this.render();
            } else {
                const newPerson = {
                    id: this._generateId(),
                    ad: this._toTitleCase(document.getElementById('p-ad').value),
                    soyad: this._toTitleCase(document.getElementById('p-soyad').value),
                    cinsiyet: document.getElementById('p-cinsiyet').value,
                    dogumTarihi: document.getElementById('p-tarih').value,
                    olumTarihi: document.getElementById('p-olum-tarihi') ? document.getElementById('p-olum-tarihi').value : '',
                    isDeceased: document.getElementById('p-deceased') ? document.getElementById('p-deceased').checked : false,
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

        document.getElementById('btn-clear-yakinlik').addEventListener('click', () => {
            this.dataManager.clearAllYakinlik();
            this.render();
            this.renderer.showToast('🧹 Tüm yakınlık dereceleri temizlendi.', 'success');
        });

        // Side panel Vefat Etti checkbox toggle dinleyicisi
        const pDeceased = document.getElementById('p-deceased');
        const pOlumTarihi = document.getElementById('p-olum-tarihi');
        if (pDeceased && pOlumTarihi) {
            pDeceased.addEventListener('change', (e) => {
                pOlumTarihi.style.display = e.target.checked ? 'block' : 'none';
            });
        }

        // ============================================================
        // DIŞA AKTARIM (EXPORT) VE İÇE AKTARIM (IMPORT)
        // ============================================================
        document.getElementById('btn-export').addEventListener('click', () => {
            const dataStr = JSON.stringify(this.dataManager.data, null, 2);
            const blob = new Blob([dataStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'soy-agaci-yedek.json';
            a.click();
            URL.revokeObjectURL(url);
            this.renderer.showToast('💾 Yedek başarıyla indirildi.', 'success');
        });

        const importInput = document.getElementById('import-file');
        document.getElementById('btn-import').addEventListener('click', () => {
            importInput.click();
        });

        importInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const parsedData = JSON.parse(event.target.result);
                    if (!parsedData.persons || !parsedData.unions) {
                        throw new Error('Geçersiz JSON formatı. "persons" ve "unions" dizileri gereklidir.');
                    }
                    // Validasyon başarılı
                    this.dataManager.data = parsedData;
                    this.dataManager.save();
                    this.dataManager.historyStack = []; // Geçmişi temizle
                    this.render();
                    this.renderer.showToast('📂 Yedek başarıyla yüklendi.', 'success');
                } catch (err) {
                    console.error("Yedek Yükleme Hatası:", err);
                    alert("Yedek yüklenirken hata oluştu: " + err.message);
                } finally {
                    e.target.value = ''; // Input sıfırlama (aynı dosyayı tekrar seçebilmek için)
                }
            };
            reader.readAsText(file);
        });
    }
}
