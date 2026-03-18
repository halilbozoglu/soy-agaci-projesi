import { DataManager } from './data-manager.js';
import { GraphRenderer } from './graph-renderer.js';
import { processImage } from './image-processor.js';

export class AppController {
    constructor() {
        this.dataManager = new DataManager();
        this.renderer = new GraphRenderer('graph-container');
        this.currentBase64Image = null;
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
        
        // "(ID)" formatında seçim yapıldıysa mevcut kişiyi dön
        const match = inputValue.match(/\((.*?)\)$/);
        const id = match ? match[1] : null;

        if (id && this.dataManager.getPerson(id)) {
            return id;
        }

        // On-the-fly oluşturma: Listede olmayan serbest isim yazıldıysa
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
            fotograf: null
        };
        
        return { isNew: true, person: newPerson };
    }

    bindEvents() {
        // Drag & Drop
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

        // Yeni Kişi Ekleme
        document.getElementById('form-person').addEventListener('submit', (e) => {
            e.preventDefault();
            
            const newPerson = {
                id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
                ad: document.getElementById('p-ad').value,
                soyad: document.getElementById('p-soyad').value,
                cinsiyet: document.getElementById('p-cinsiyet').value,
                dogumTarihi: document.getElementById('p-tarih').value,
                yakinlikDerecesi: document.getElementById('p-yakinlik').value,
                fotograf: this.currentBase64Image
            };

            this.dataManager.addPerson(newPerson);
            this.render();
            
            e.target.reset();
            this.currentBase64Image = null;
            previewContainer.classList.add('hidden');
            previewContainer.classList.remove('flex');
        });

        // Birliktelik (Union) Ekleme & On-The-Fly Makro
        document.getElementById('form-union').addEventListener('submit', (e) => {
            e.preventDefault();
            
            const p1Val = document.getElementById('u-partner1').value;
            const p2Val = document.getElementById('u-partner2').value;
            const childVal = document.getElementById('u-children').value;

            // Güvenli Batch İşlem başlat
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
                        this.dataManager.data.persons.push(res.person); // Batch içinde arka planda ekle
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
                this.dataManager.undo(); // Hata durumunda rollback
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
