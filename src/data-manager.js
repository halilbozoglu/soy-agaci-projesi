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
        // Derin kopya (Deep Copy) ile anlık durum (snapshot) al
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
        // Native confirm onayı UI arayüzünde halledilecek, burada sadece sıfırlama yapılıyor
        localStorage.clear();
        this.data = { persons: [], unions: [] };
        this.historyStack = [];
    }

    // Atomik işlem sarmalayıcı (wrapper)
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
            
            // Kişiyi tüm birlikteliklerden (unions) temizle
            this.data.unions.forEach(u => {
                u.partnerIds = u.partnerIds.filter(pid => pid !== id);
                u.childrenIds = u.childrenIds.filter(cid => cid !== id);
            });
            
            // Boş kalan birliktelikleri (kimse kalmadıysa) temizle
            this.data.unions = this.data.unions.filter(u => u.partnerIds.length > 0 || u.childrenIds.length > 0);
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
}
