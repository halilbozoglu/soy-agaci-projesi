const MAX_HISTORY = 15;

export class DataManager {
    constructor() {
        this.data = { persons: [], unions: [] };
        this.historyStack = [];
        this.load();
    }

    load() {
        const stored = localStorage.getItem('familyTreeData');
        if (stored) {
            try {
                this.data = JSON.parse(stored);
            } catch (e) {
                console.error("Veri yükleme hatası:", e);
                this.data = { persons: [], unions: [] };
            }
        }
        // Legacy Data Migration: Title Case düzeltme
        this._migrateTitleCase();
        // Default alan migrasyonu (isDeceased, isDivorced)
        this._migrateDefaults();
    }

    _toTitleCase(str) {
        if (!str) return '';
        return str.trim().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    }

    _migrateTitleCase() {
        let changed = false;
        this.data.persons.forEach(p => {
            const newAd = this._toTitleCase(p.ad);
            const newSoyad = this._toTitleCase(p.soyad);
            if (newAd !== p.ad || newSoyad !== p.soyad) {
                p.ad = newAd;
                p.soyad = newSoyad;
                changed = true;
            }
        });
        if (changed) this.save();
    }

    _migrateDefaults() {
        let changed = false;
        this.data.persons.forEach(p => {
            if (p.isDeceased === undefined) { p.isDeceased = false; changed = true; }
        });
        this.data.unions.forEach(u => {
            if (u.isDivorced === undefined) { u.isDivorced = false; changed = true; }
        });
        if (changed) this.save();
    }

    // Kişi Birleştirme: sourceId'nin tüm referanslarını targetId ile değiştir, sonra source'u sil
    mergePersons(sourceId, targetId) {
        this.executeTransaction(() => {
            this.data.unions.forEach(u => {
                // partnerIds'te source → target
                if (u.partnerIds.includes(sourceId)) {
                    u.partnerIds = u.partnerIds.map(pid => pid === sourceId ? targetId : pid);
                    u.partnerIds = [...new Set(u.partnerIds)]; // deduplicate
                }
                // childrenIds'te source → target
                if (u.childrenIds.includes(sourceId)) {
                    u.childrenIds = u.childrenIds.map(cid => cid === sourceId ? targetId : cid);
                    u.childrenIds = [...new Set(u.childrenIds)]; // deduplicate
                }
            });
            // Source kişiyi sil
            this.data.persons = this.data.persons.filter(p => p.id !== sourceId);
            // Union GC
            this.data.unions = this.data.unions.filter(u => {
                const totalMembers = u.partnerIds.length + u.childrenIds.length;
                if (totalMembers === 0) return false;
                if (u.partnerIds.length <= 1 && u.childrenIds.length === 0) return false;
                return true;
            });
        });
    }

    // Boşanma durumunu toggle et
    toggleDivorced(unionId) {
        this.executeTransaction(() => {
            const u = this.data.unions.find(u => u.id === unionId);
            if (u) u.isDivorced = !u.isDivorced;
        });
    }

    save() {
        localStorage.setItem('familyTreeData', JSON.stringify(this.data));
    }

    pushHistory() {
        const snapshot = JSON.stringify(this.data);
        this.historyStack.push(JSON.parse(snapshot));
        if (this.historyStack.length > MAX_HISTORY) {
            this.historyStack.shift();
        }
    }

    undo() {
        if (this.historyStack.length > 0) {
            this.data = this.historyStack.pop();
            this.save();
            return true;
        }
        return false;
    }

    clearAllData() {
        localStorage.clear();
        this.data = { persons: [], unions: [] };
        this.historyStack = [];
    }

    executeTransaction(operation) {
        this.pushHistory();
        try {
            operation();
            this.save();
        } catch (error) {
            console.error("İşlem başarısız oldu, geri alınıyor (Rollback):", error);
            this.undo();
            throw error; 
        }
    }

    addPerson(person) {
        this.executeTransaction(() => {
            this.data.persons.push(person);
        });
    }

    addUnion(union) {
        this.executeTransaction(() => {
            if (!union.partnerIds) union.partnerIds = [];
            if (!union.childrenIds) union.childrenIds = [];
            this.data.unions.push(union);
        });
    }
    
    updatePerson(id, updates) {
        this.executeTransaction(() => {
            const index = this.data.persons.findIndex(p => p.id === id);
            if(index !== -1) {
                const oldPerson = this.data.persons[index];
                
                // Cinsiyet senkronizasyonu: Eğer "Kişiyi Düzenle" formundan cinsiyet değişirse ve yeni değer Erkek/Kadın ise
                if (updates.cinsiyet && updates.cinsiyet !== oldPerson.cinsiyet && updates.cinsiyet !== 'Belirtilmemiş') {
                    const newOpposite = updates.cinsiyet === 'Erkek' ? 'Kadın' : 'Erkek';
                    
                    const unions = this.getUnionsForPerson(id);
                    unions.forEach(u => {
                        u.partnerIds.forEach(pid => {
                            if (pid !== id) {
                                const partnerIndex = this.data.persons.findIndex(p => p.id === pid);
                                if (partnerIndex !== -1) {
                                    this.data.persons[partnerIndex].cinsiyet = newOpposite;
                                }
                            }
                        });
                    });
                }
                
                this.data.persons[index] = { ...oldPerson, ...updates };
            } else {
                throw new Error("Kişi bulunamadı.");
            }
        });
    }
    
    deletePerson(id) {
        this.executeTransaction(() => {
            this.data.persons = this.data.persons.filter(p => p.id !== id);
            this.data.unions.forEach(u => {
                u.partnerIds = u.partnerIds.filter(pid => pid !== id);
                u.childrenIds = u.childrenIds.filter(cid => cid !== id);
            });
            // Union Garbage Collection
            this.data.unions = this.data.unions.filter(u => {
                const totalMembers = u.partnerIds.length + u.childrenIds.length;
                if (totalMembers === 0) return false;
                if (u.partnerIds.length <= 1 && u.childrenIds.length === 0) return false;
                return true;
            });
        });
    }

    deleteUnion(id) {
        this.executeTransaction(() => {
            this.data.unions = this.data.unions.filter(u => u.id !== id);
        });
    }

    getPerson(id) {
        return this.data.persons.find(p => p.id === id);
    }
    
    getUnion(id) {
        return this.data.unions.find(u => u.id === id);
    }

    // Kişinin bağlı olduğu tüm Union'ları döndür (partner olarak)
    getUnionsForPerson(personId) {
        return this.data.unions.filter(u => u.partnerIds.includes(personId));
    }

    // Kişinin ebeveyn Union'ını bul (çocuk olarak bağlı olduğu)
    getParentUnion(personId) {
        return this.data.unions.find(u => u.childrenIds.includes(personId));
    }

    // --- CYCLE DETECTION (DFS tabanlı) ---
    // sourceId'den targetId'ye soy çizgisinde bir yol var mı kontrol eder.
    // sourceId'nin soyundan targetId çıkıyorsa, onları evlendirmek döngü yaratır.
    hasCycle(sourceId, targetId) {
        // sourceId'den aşağı doğru DFS yaparak targetId'ye ulaşılabilir mi bak
        const visited = new Set();
        const stack = [sourceId];

        while (stack.length > 0) {
            const current = stack.pop();
            if (current === targetId) return true;
            if (visited.has(current)) continue;
            visited.add(current);

            // Bu kişinin partner olduğu tüm union'ları bul
            this.data.unions.forEach(u => {
                if (u.partnerIds.includes(current)) {
                    // Bu union'un çocuklarını stack'e ekle
                    u.childrenIds.forEach(childId => {
                        if (!visited.has(childId)) stack.push(childId);
                    });
                }
            });
        }
        return false;
    }

    // İki kişi arasında evlilik döngü yaratır mı?
    wouldCreateCycle(personId1, personId2) {
        return this.hasCycle(personId1, personId2) || this.hasCycle(personId2, personId1);
    }

    // Tüm offset'leri sıfırla → Sugiyama optimum konumlarına döndür
    // Tüm yakınlık derecelerini temizle
    clearAllYakinlik() {
        this.executeTransaction(() => {
            this.data.persons.forEach(p => {
                p.yakinlikDerecesi = '';
            });
        });
    }

    resetAllOffsets() {
        this.executeTransaction(() => {
            this.data.persons.forEach(p => {
                p.offsetX = 0;
                p.offsetY = 0;
            });
            this.data.unions.forEach(u => {
                u.offsetX = 0;
                u.offsetY = 0;
            });
        });
    }

    // İki kişi arasında mevcut bir Union bul (partner olarak)
    findUnionBetween(personId1, personId2) {
        return this.data.unions.find(u =>
            u.partnerIds.includes(personId1) && u.partnerIds.includes(personId2)
        );
    }

    // Re-Parenting: Çocuğun ebeveynlerini değiştir (atomik)
    reparentChild(childId, newParentIds) {
        this.executeTransaction(() => {
            // 1. Çocuğu eski tüm Union'lardan child olarak çıkar
            this.data.unions.forEach(u => {
                u.childrenIds = u.childrenIds.filter(cid => cid !== childId);
            });

            // 2. Boş kalan Union'ları temizle (GC)
            this.data.unions = this.data.unions.filter(u => {
                const totalMembers = u.partnerIds.length + u.childrenIds.length;
                if (totalMembers === 0) return false;
                if (u.partnerIds.length <= 1 && u.childrenIds.length === 0) return false;
                return true;
            });

            // 3. Yeni ebeveynler arasında mevcut Union var mı?
            let targetUnion = null;
            if (newParentIds.length === 2) {
                targetUnion = this.data.unions.find(u =>
                    u.partnerIds.includes(newParentIds[0]) && u.partnerIds.includes(newParentIds[1])
                );
            } else if (newParentIds.length === 1) {
                // Tek ebeveyn: o kişinin partner olduğu herhangi bir union'a bağla
                targetUnion = this.data.unions.find(u => u.partnerIds.includes(newParentIds[0]));
            }

            if (targetUnion) {
                if (!targetUnion.childrenIds.includes(childId)) {
                    targetUnion.childrenIds.push(childId);
                }
            } else {
                // Yeni Union oluştur
                const newUnionId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
                this.data.unions.push({
                    id: newUnionId,
                    partnerIds: [...newParentIds],
                    childrenIds: [childId],
                    offsetX: 0, offsetY: 0
                });
            }
        });
    }
}
