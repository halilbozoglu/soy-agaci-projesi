export async function processImage(file) {
    if (!file) return null;

    return new Promise((resolve, reject) => {
        // Dosya tipini kontrol et
        if (!file.type.startsWith('image/')) {
            reject(new Error("Lütfen geçerli bir resim dosyası seçin."));
            return;
        }

        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                // Maksimum 150x150 oranında küçültme işlemi (Aspect Ratio korunarak)
                const MAX_SIZE = 150;
                if (width > height) {
                    if (width > MAX_SIZE) {
                        height *= MAX_SIZE / width;
                        width = MAX_SIZE;
                    }
                } else {
                    if (height > MAX_SIZE) {
                        width *= MAX_SIZE / height;
                        height = MAX_SIZE;
                    }
                }

                // Kusüratları engelle
                canvas.width = Math.round(width);
                canvas.height = Math.round(height);

                const ctx = canvas.getContext('2d');
                // Transparent arkaplanı beyaza dönüştürmek isterseniz (opsiyonel):
                // ctx.fillStyle = '#ffffff';
                // ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

                // image/webp formatında 0.6 kalite parametresiyle encode et
                const base64URI = canvas.toDataURL('image/webp', 0.6);
                resolve(base64URI);
            };
            img.onerror = () => reject(new Error("Resim dosyası tarayıcı tarafından okunamadı."));
            img.src = event.target.result;
        };
        reader.onerror = () => reject(new Error("Dosya okuma sırasında bir hata meydana geldi."));
        reader.readAsDataURL(file);
    });
}
