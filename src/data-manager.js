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
                this.data.persons[index] = { ...this.data.persons[index], ...updates };
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
    resetAllOffsets() {
        this.executeTransaction(() => {
            this.data.persons.forEach(p => {
                p.offsetX = 0;
                p.offsetY = 0;
            });
        });
    }
}
