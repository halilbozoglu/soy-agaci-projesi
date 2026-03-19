import { DataManager } from './data-manager.js';
import { GraphRenderer } from './graph-renderer.js';
import { processImage } from './image-processor.js';

export class AppController {
    constructor() {
        this.dataManager = new DataManager();
        this.currentBase64Image = null;
        this.editingPersonId = null; // Düzenleme modu: aktif kişi ID'si

        // --- Context Menu Callback'leri ---
        this.renderer = new GraphRenderer('graph-container', {
            edit: (person) => this.enterEditMode(person),
            addParent: (person) => this.addParentFor(person),
            addChild: (person) => this.addChildFor(person),
            addPartner: (person) => this.addPartnerFor(person),
            linkTwoPersons: (p1, p2) => this.linkTwoPersons(p1, p2),
            delete: (person) => this.deletePersonWithConfirm(person),
            onDragEnd: (personId, ox, oy) => this.saveOffset(personId, ox, oy)
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

    resolvePersonId(inputValue) {
        if (!inputValue || inputValue.trim() === "") return null;
        
        const match = inputValue.match(/\((.*?)\)$/);
        const id = match ? match[1] : null;

        if (id && this.dataManager.getPerson(id)) {
            return id;
        }

        const parts = inputValue.trim().split(' ');
        const soyad = parts.length > 1 ? parts.pop() : '';
        const ad = parts.join(' ') || inputValue.trim();

        const newId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
        const newPerson = {
            id: newId,
            ad: ad,
            soyad: soyad,
            cinsiyet: 'Belirtilmemiş',
            dogumTarihi: '',
            yakinlikDerecesi: 'Otomatik Eklendi',
            fotograf: null,
            offsetX: 0,
            offsetY: 0
        };
        
        return { isNew: true, person: newPerson };
    }

    // --- 4. DÜZENLEME MODU (EDIT MODE) ---
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

        // Buton ve başlığı güncelle
        const submitBtn = document.getElementById('btn-submit-person');
        const formTitle = document.getElementById('form-person-title');
        submitBtn.textContent = 'Kişiyi Güncelle';
        submitBtn.classList.remove('btn-primary');
        submitBtn.classList.add('btn-edit-mode');
        formTitle.textContent = '✏️ Kişiyi Düzenle';

        // İptal butonu göster
        document.getElementById('btn-cancel-edit').classList.remove('hidden');

        // Sidebar'ı öne çıkar ve scrollla
        document.getElementById('p-ad').focus();
    }

    exitEditMode() {
        this.editingPersonId = null;

        const form = document.getElementById('form-person');
        form.reset();
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

    // --- CONTEXT MENU ACTIONS ---
    deletePersonWithConfirm(person) {
        if (confirm(`"${person.ad} ${person.soyad}" kişisini ve tüm bağlantılarını silmek istediğinize emin misiniz?`)) {
            this.dataManager.deletePerson(person.id);
            this.render();
        }
    }

    // --- 1. ÇİFT EBEVEYN EKLEME (DOUBLE NODE CREATION) ---
    addParentFor(person) {
        const babaName = prompt(`"${person.ad} ${person.soyad}" için Baba adı girin (Ad Soyad):`);
        const anneName = prompt(`"${person.ad} ${person.soyad}" için Anne adı girin (Ad Soyad):`);

        // Her ikisi de boşsa çık
        if ((!babaName || babaName.trim() === '') && (!anneName || anneName.trim() === '')) return;

        this.dataManager.pushHistory();
        try {
            const partnerIds = [];

            // Baba işle
            if (babaName && babaName.trim() !== '') {
                const res = this.resolvePersonId(babaName);
                if (typeof res === 'string') {
                    partnerIds.push(res);
                } else if (res && res.isNew) {
                    res.person.cinsiyet = 'Erkek';
                    this.dataManager.data.persons.push(res.person);
                    partnerIds.push(res.person.id);
                }
            }

            // Anne işle
            if (anneName && anneName.trim() !== '') {
                const res = this.resolvePersonId(anneName);
                if (typeof res === 'string') {
                    partnerIds.push(res);
                } else if (res && res.isNew) {
                    res.person.cinsiyet = 'Kadın';
                    this.dataManager.data.persons.push(res.person);
                    partnerIds.push(res.person.id);
                }
            }

            if (partnerIds.length > 0) {
                const newUnion = {
                    id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
                    partnerIds: [...new Set(partnerIds)],
                    childrenIds: [person.id]
                };
                this.dataManager.data.unions.push(newUnion);
            }

            this.dataManager.save();
            this.render();
        } catch (error) {
            console.error("Ebeveyn ekleme hatası:", error);
            this.dataManager.undo();
        }
    }

    // --- 2. HIZLI EŞ / PARTNER EKLEME ---
    addPartnerFor(person) {
        const partnerName = prompt(`"${person.ad} ${person.soyad}" için eş/partner adı girin (Ad Soyad):`);
        if (!partnerName || partnerName.trim() === '') return;

        this.dataManager.pushHistory();
        try {
            const res = this.resolvePersonId(partnerName);
            let partnerId;
            if (typeof res === 'string') {
                partnerId = res;
            } else if (res && res.isNew) {
                this.dataManager.data.persons.push(res.person);
                partnerId = res.person.id;
            } else { return; }

            const newUnion = {
                id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
                partnerIds: [person.id, partnerId],
                childrenIds: []
            };
            this.dataManager.data.unions.push(newUnion);
            this.dataManager.save();
            this.render();
        } catch (error) {
            console.error("Partner ekleme hatası:", error);
            this.dataManager.undo();
        }
    }

    // --- 3. İKİ MEVCUT KİŞİYİ EVLENDİRME (LINKING MODE CALLBACK) ---
    linkTwoPersons(person1, person2) {
        this.dataManager.pushHistory();
        try {
            const newUnion = {
                id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
                partnerIds: [person1.id, person2.id],
                childrenIds: []
            };
            this.dataManager.data.unions.push(newUnion);
            this.dataManager.save();
            this.render();
        } catch (error) {
            console.error("Evlendirme hatası:", error);
            this.dataManager.undo();
        }
    }

    addChildFor(person) {
        const childName = prompt(`"${person.ad} ${person.soyad}" için çocuk adı girin (Ad Soyad):`);
        if (!childName || childName.trim() === '') return;

        this.dataManager.pushHistory();
        try {
            const res = this.resolvePersonId(childName);
            let childId;
            if (typeof res === 'string') {
                childId = res;
            } else if (res && res.isNew) {
                this.dataManager.data.persons.push(res.person);
                childId = res.person.id;
            } else { return; }

            // Kişinin mevcut bir union'ında çocuk olarak ekle, yoksa yeni oluştur
            const existingUnion = this.dataManager.data.unions.find(u => u.partnerIds.includes(person.id));
            if (existingUnion) {
                existingUnion.childrenIds.push(childId);
            } else {
                const newUnion = {
                    id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
                    partnerIds: [person.id],
                    childrenIds: [childId]
                };
                this.dataManager.data.unions.push(newUnion);
            }
            this.dataManager.save();
            this.render();
        } catch (error) {
            console.error("Çocuk ekleme hatası:", error);
            this.dataManager.undo();
        }
    }

    // --- 2. DRAG OFFSET KAYDETME ---
    saveOffset(personId, ox, oy) {
        const person = this.dataManager.getPerson(personId);
        if (person) {
            person.offsetX = ox;
            person.offsetY = oy;
            this.dataManager.save();
        }
    }

    bindEvents() {
        // Drag & Drop (Fotoğraf)
        const dropZone = document.getElementById('drop-zone');
        const fileInput = document.getElementById('p-foto');
        const previewContainer = document.getElementById('preview-container');
        const imgPreview = document.getElementById('img-preview');

        dropZone.addEventListener('click', () => fileInput.click());
        
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('bg-slate-100');
        });

        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('bg-slate-100');
        });

        const handleFile = async (file) => {
            if (file) {
                try {
                    this.currentBase64Image = await processImage(file);
                    imgPreview.src = this.currentBase64Image;
                    previewContainer.classList.remove('hidden');
                    previewContainer.classList.add('flex');
                } catch (err) {
                    alert(err.message);
                }
            }
        };

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('bg-slate-100');
            handleFile(e.dataTransfer.files[0]);
        });

        fileInput.addEventListener('change', (e) => {
            handleFile(e.target.files[0]);
        });

        // --- Kişi Ekleme / Güncelleme FORMU ---
        document.getElementById('form-person').addEventListener('submit', (e) => {
            e.preventDefault();
            
            if (this.editingPersonId) {
                // GÜNCELLEME MODU
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
                // YENİ KİŞİ EKLEME MODU
                const newPerson = {
                    id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
                    ad: document.getElementById('p-ad').value,
                    soyad: document.getElementById('p-soyad').value,
                    cinsiyet: document.getElementById('p-cinsiyet').value,
                    dogumTarihi: document.getElementById('p-tarih').value,
                    yakinlikDerecesi: document.getElementById('p-yakinlik').value,
                    fotograf: this.currentBase64Image,
                    offsetX: 0,
                    offsetY: 0
                };

                this.dataManager.addPerson(newPerson);
                this.render();
                
                e.target.reset();
                this.currentBase64Image = null;
                previewContainer.classList.add('hidden');
                previewContainer.classList.remove('flex');
            }
        });

        // İptal butonu
        document.getElementById('btn-cancel-edit').addEventListener('click', () => {
            this.exitEditMode();
        });

        // Birliktelik (Union) Ekleme & On-The-Fly Makro
        document.getElementById('form-union').addEventListener('submit', (e) => {
            e.preventDefault();
            
            const p1Val = document.getElementById('u-partner1').value;
            const p2Val = document.getElementById('u-partner2').value;
            const childVal = document.getElementById('u-children').value;

            this.dataManager.pushHistory();

            try {
                const partnerIds = [];
                const childrenIds = [];

                const processInput = (val, targetArray) => {
                    const res = this.resolvePersonId(val);
                    if (!res) return;
                    if (typeof res === 'string') {
                        targetArray.push(res);
                    } else if (res.isNew) {
                        this.dataManager.data.persons.push(res.person);
                        targetArray.push(res.person.id);
                    }
                };

                processInput(p1Val, partnerIds);
                processInput(p2Val, partnerIds);

                if (childVal && childVal.trim() !== '') {
                    const childrenArray = childVal.split(',').map(s => s.trim());
                    childrenArray.forEach(cv => processInput(cv, childrenIds));
                }

                if (partnerIds.length > 0 || childrenIds.length > 0) {
                    const newUnion = {
                        id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
                        partnerIds: [...new Set(partnerIds)],
                        childrenIds: [...new Set(childrenIds)]
                    };
                    this.dataManager.data.unions.push(newUnion);
                }

                this.dataManager.save(); 
                this.render();
                e.target.reset();
            } catch (error) {
                console.error("Batch Transaction Hatası:", error);
                this.dataManager.undo();
                alert("Bağlantı işlemi sırasında bir hata oluştu ve geri alındı.");
            }
        });

        // Global Butonlar
        document.getElementById('btn-undo').addEventListener('click', () => {
            if(this.dataManager.undo()) {
                this.render();
            } else {
                alert("Stack boş: Geri alınabilecek işlem yok.");
            }
        });

        document.getElementById('btn-clear').addEventListener('click', () => {
            if(confirm("Tüm veri tabanını silmek istediğinize emin misiniz? (Bu işlem geri alınamaz!)")) {
                this.dataManager.clearAllData();
                this.render();
            }
        });
    }
}
