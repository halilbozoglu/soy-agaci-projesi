import * as d3dag from 'd3-dag';
import * as d3 from 'd3';

export class GraphRenderer {
    constructor(containerId, callbacks) {
        this.containerId = containerId;
        this.callbacks = callbacks || {};
        this.isLinkingMode = false;
        this._linkingSourcePerson = null;
        const container = document.getElementById(containerId);
        container.innerHTML = "";
        
        this.svg = d3.select(container).append("svg")
            .attr("id", "dag-svg")
            .style("width", "100%")
            .style("height", "100%")
            .style("min-height", "600px");
        
        // SVG Defs: Gölge filtreleri ve gradient tanımları
        const defs = this.svg.append("defs");

        // Kart gölgesi
        const cardShadow = defs.append("filter")
            .attr("id", "card-shadow")
            .attr("x", "-20%").attr("y", "-20%")
            .attr("width", "140%").attr("height", "140%");
        cardShadow.append("feDropShadow")
            .attr("dx", "0").attr("dy", "3")
            .attr("stdDeviation", "6")
            .attr("flood-color", "rgba(15,23,42,0.12)");

        // Union glow efekti
        const unionGlow = defs.append("filter")
            .attr("id", "union-glow")
            .attr("x", "-50%").attr("y", "-50%")
            .attr("width", "200%").attr("height", "200%");
        unionGlow.append("feGaussianBlur")
            .attr("stdDeviation", "3")
            .attr("result", "blur");
        const merge = unionGlow.append("feMerge");
        merge.append("feMergeNode").attr("in", "blur");
        merge.append("feMergeNode").attr("in", "SourceGraphic");

        // Link gradient
        const linkGrad = defs.append("linearGradient")
            .attr("id", "link-gradient")
            .attr("x1", "0%").attr("y1", "0%")
            .attr("x2", "0%").attr("y2", "100%");
        linkGrad.append("stop").attr("offset", "0%").attr("stop-color", "#a78bfa");
        linkGrad.append("stop").attr("offset", "100%").attr("stop-color", "#ec4899");

        // Erkek kart gradient
        const maleGrad = defs.append("linearGradient")
            .attr("id", "male-card-bg")
            .attr("x1", "0%").attr("y1", "0%")
            .attr("x2", "100%").attr("y2", "100%");
        maleGrad.append("stop").attr("offset", "0%").attr("stop-color", "#eff6ff");
        maleGrad.append("stop").attr("offset", "100%").attr("stop-color", "#dbeafe");

        // Kadın kart gradient
        const femaleGrad = defs.append("linearGradient")
            .attr("id", "female-card-bg")
            .attr("x1", "0%").attr("y1", "0%")
            .attr("x2", "100%").attr("y2", "100%");
        femaleGrad.append("stop").attr("offset", "0%").attr("stop-color", "#fdf2f8");
        femaleGrad.append("stop").attr("offset", "100%").attr("stop-color", "#fce7f3");

        // Default kart gradient
        const defaultGrad = defs.append("linearGradient")
            .attr("id", "default-card-bg")
            .attr("x1", "0%").attr("y1", "0%")
            .attr("x2", "100%").attr("y2", "100%");
        defaultGrad.append("stop").attr("offset", "0%").attr("stop-color", "#f8fafc");
        defaultGrad.append("stop").attr("offset", "100%").attr("stop-color", "#f1f5f9");

        this.g = this.svg.append("g").attr("id", "zoom-group");
        
        // --- SMOOTH PAN & ZOOM ---
        this.zoom = d3.zoom()
            .scaleExtent([0.1, 4])
            .on("zoom", (e) => this.g.attr("transform", e.transform));
        
        this.svg.call(this.zoom);
        this.svg.on("dblclick.zoom", null);
        this.svg.on("click", () => {
            this.hideContextMenu();
            if (this.isLinkingMode) {
                this.cancelLinkingMode();
            }
        });

        // ESC tuşu ile linking mode iptal
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isLinkingMode) {
                this.cancelLinkingMode();
            }
        });

        // İç referanslar (drag esnasında çizgileri güncellemek için)
        this._nodePositions = new Map();
        this._linkData = [];
        this._lineFn = d3.line().curve(d3.curveMonotoneY).x(d => d.x).y(d => d.y);
    }

    hideContextMenu() {
        const existing = document.getElementById('node-context-menu');
        if (existing) existing.remove();
    }

    showContextMenu(event, personData) {
        this.hideContextMenu();

        const menu = document.createElement('div');
        menu.id = 'node-context-menu';
        menu.className = 'ctx-menu';
        
        const items = [
            { icon: '✏️', label: 'Düzenle', action: 'edit' },
            { icon: '👨‍👩‍👧', label: 'Ebeveyn Ekle', action: 'addParent' },
            { icon: '👶', label: 'Çocuk Ekle', action: 'addChild' },
            { icon: '💍', label: 'Eş/Partner Ekle', action: 'addPartner' },
            { icon: '🔗', label: 'Başkasıyla Evlendir', action: 'startLinking' },
            { icon: '🗑️', label: 'Sil', action: 'delete', danger: true }
        ];

        items.forEach(item => {
            const btn = document.createElement('button');
            btn.className = `ctx-menu-item ${item.danger ? 'ctx-menu-danger' : ''}`;
            btn.innerHTML = `<span>${item.icon}</span><span>${item.label}</span>`;
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.hideContextMenu();
                if (item.action === 'startLinking') {
                    this.enterLinkingMode(personData);
                } else if (this.callbacks[item.action]) {
                    this.callbacks[item.action](personData);
                }
            });
            menu.appendChild(btn);
        });

        const container = document.getElementById(this.containerId);
        container.appendChild(menu);

        const containerRect = container.getBoundingClientRect();
        let left = event.clientX - containerRect.left + 10;
        let top = event.clientY - containerRect.top + 10;

        if (left + 170 > containerRect.width) left = left - 180;
        if (top + 200 > containerRect.height) top = top - 210;

        menu.style.left = `${left}px`;
        menu.style.top = `${top}px`;
    }

    // --- LINKING MODE (Eşleştirme Modu) ---
    enterLinkingMode(sourcePerson) {
        this.isLinkingMode = true;
        this._linkingSourcePerson = sourcePerson;
        this.showToast(`🔗 "${sourcePerson.ad} ${sourcePerson.soyad}" için eşleştirilecek 2. kişiyi ağaçtan seçin...`, 'linking');
        // SVG cursor değiştir
        this.svg.style("cursor", "crosshair");
    }

    cancelLinkingMode() {
        this.isLinkingMode = false;
        this._linkingSourcePerson = null;
        this.hideToast();
        this.svg.style("cursor", null);
    }

    showToast(message, type) {
        this.hideToast();
        const container = document.getElementById(this.containerId);
        const toast = document.createElement('div');
        toast.id = 'linking-toast';
        toast.className = `toast-notification ${type === 'linking' ? 'toast-linking' : ''}`;
        toast.innerHTML = `<span>${message}</span><button class="toast-close" onclick="this.parentElement.remove()">✕</button>`;
        container.appendChild(toast);
    }

    hideToast() {
        const existing = document.getElementById('linking-toast');
        if (existing) existing.remove();
    }

    _getCardFill(person) {
        if (person.cinsiyet === 'Erkek') return 'url(#male-card-bg)';
        if (person.cinsiyet === 'Kadın') return 'url(#female-card-bg)';
        return 'url(#default-card-bg)';
    }

    _getCardStroke(person) {
        if (person.cinsiyet === 'Erkek') return '#93c5fd';
        if (person.cinsiyet === 'Kadın') return '#f9a8d4';
        return '#cbd5e1';
    }

    render(dataManager) {
        this.g.selectAll("*").remove();
        this._nodePositions.clear();

        const data = dataManager.data;
        if (data.persons.length === 0) return;

        const nodes = [];
        data.persons.forEach(p => {
            nodes.push({ id: `p_${p.id}`, type: 'person', data: p });
        });
        data.unions.forEach(u => {
            nodes.push({ id: `u_${u.id}`, type: 'union', data: u });
        });

        const links = [];
        data.unions.forEach(u => {
            const uId = `u_${u.id}`;
            u.partnerIds.forEach(pId => {
                links.push({ source: `p_${pId}`, target: uId });
            });
            u.childrenIds.forEach(cId => {
                links.push({ source: uId, target: `p_${cId}` });
            });
        });

        // --- VERİ TEMİZLİĞİ VE SANAL KÖK ---
        const nodeIds = new Set(nodes.map(n => n.id));
        const DUMMY_ROOT_ID = 'virtual_dummy_root';
        
        nodes.push({ id: DUMMY_ROOT_ID, type: 'dummy', data: { ad: '', soyad: '', cinsiyet: '', dogumTarihi: '', yakinlikDerecesi: '', fotograf: null } });
        nodeIds.add(DUMMY_ROOT_ID);

        const parentMap = new Map();
        nodes.forEach(node => {
            if (node.id === DUMMY_ROOT_ID) { parentMap.set(node.id, []); return; }
            let parents = links.filter(l => l.target === node.id).map(l => l.source);
            parents = parents.filter(pId => pId && nodeIds.has(pId));
            parentMap.set(node.id, parents);
        });

        nodes.forEach(node => {
            if (node.id === DUMMY_ROOT_ID) return;
            const parents = parentMap.get(node.id);
            if (parents.length === 0) parents.push(DUMMY_ROOT_ID);
        });

        let dagInfo;
        try {
            const builder = d3dag.dagStratify().id(d => d.id).parentIds(d => parentMap.get(d.id));
            dagInfo = builder(nodes);
        } catch (error) {
            console.error("DAG Stratify Hatası:", error);
            return;
        }

        try {
            const layout = d3dag.sugiyama()
                .nodeSize(n => {
                    if (!n || !n.data) return [0, 0];
                    return n.data.type === 'union' ? [60, 60] : [200, 220];
                })
                .layering(d3dag.layeringSimplex())
                .decross(d3dag.decrossOpt())
                .coord(d3dag.coordQuad());
            layout(dagInfo);
        } catch(error) {
            console.error("DAG Layout Hatası:", error);
            return;
        }

        // Düğüm pozisyonlarını kaydet (drag esnasında çizgi güncelleme için)
        const allDescendants = dagInfo.descendants();
        allDescendants.forEach(d => {
            if (d.data.id === DUMMY_ROOT_ID) return;
            const ox = (d.data.type === 'person' && d.data.data.offsetX) || 0;
            const oy = (d.data.type === 'person' && d.data.data.offsetY) || 0;
            this._nodePositions.set(d.data.id, { x: d.x + ox, y: d.y + oy, baseX: d.x, baseY: d.y });
        });

        // --- LINK ÇİZİMİ ---
        const dagLinks = dagInfo.links().filter(d => d.source.data.id !== DUMMY_ROOT_ID);
        this._linkData = dagLinks;

        const linksLayer = this.g.append("g").attr("class", "links-layer");
        linksLayer.selectAll("path")
            .data(dagLinks)
            .enter()
            .append("path")
            .attr("class", "dag-link")
            .attr("d", d => {
                const srcPos = this._nodePositions.get(d.source.data.id);
                const tgtPos = this._nodePositions.get(d.target.data.id);
                if (srcPos && tgtPos) {
                    return this._lineFn([srcPos, tgtPos]);
                }
                return this._lineFn(d.points);
            })
            .attr("fill", "none")
            .attr("stroke", "url(#link-gradient)")
            .attr("stroke-width", 2.5)
            .attr("stroke-opacity", 0.7);

        // --- DÜĞÜM ÇİZİMİ ---
        const nodeGroup = this.g.append("g").attr("class", "nodes-layer")
            .selectAll("g")
            .data(allDescendants)
            .enter()
            .filter(d => d.data.id !== DUMMY_ROOT_ID)
            .append("g")
            .attr("class", d => `node-group node-type-${d.data.type}`)
            .attr("data-node-id", d => d.data.id)
            .attr("transform", d => {
                const pos = this._nodePositions.get(d.data.id);
                return pos ? `translate(${pos.x},${pos.y})` : `translate(${d.x},${d.y})`;
            });

        // --- UNION düğümleri (Glow efektli) ---
        const unionGroups = nodeGroup.filter(d => d.data.type === 'union');
        unionGroups.append("circle")
            .attr("r", 14)
            .attr("fill", "#ec4899")
            .attr("stroke", "#fbcfe8")
            .attr("stroke-width", 3)
            .style("cursor", "pointer")
            .style("filter", "url(#union-glow)");
        unionGroups.append("text")
            .attr("text-anchor", "middle")
            .attr("dy", "0.35em")
            .attr("fill", "white")
            .attr("font-size", "12px")
            .attr("font-weight", "bold")
            .text("♥");

        // --- PERSON düğümleri ---
        const personGroups = nodeGroup.filter(d => d.data.type === 'person');
        const cardWidth = 170;
        const cardHeight = 90;
        const self = this;

        // Kart arka planı (cinsiyet bazlı gradient)
        personGroups.append("rect")
            .attr("x", -cardWidth/2)
            .attr("y", -cardHeight/2)
            .attr("width", cardWidth)
            .attr("height", cardHeight)
            .attr("rx", 14)
            .attr("fill", d => self._getCardFill(d.data.data))
            .attr("stroke", d => self._getCardStroke(d.data.data))
            .attr("stroke-width", 2)
            .style("cursor", "pointer")
            .style("filter", "url(#card-shadow)");

        // Cinsiyet ikonu (sol üst köşede küçük daire)
        personGroups.append("circle")
            .attr("cx", -cardWidth/2 + 14)
            .attr("cy", -cardHeight/2 + 14)
            .attr("r", 8)
            .attr("fill", d => d.data.data.cinsiyet === 'Erkek' ? '#3b82f6' : d.data.data.cinsiyet === 'Kadın' ? '#ec4899' : '#94a3b8')
            .attr("opacity", 0.8);
        personGroups.append("text")
            .attr("x", -cardWidth/2 + 14)
            .attr("y", -cardHeight/2 + 14)
            .attr("text-anchor", "middle")
            .attr("dy", "0.35em")
            .attr("fill", "white")
            .attr("font-size", "9px")
            .text(d => d.data.data.cinsiyet === 'Erkek' ? '♂' : d.data.data.cinsiyet === 'Kadın' ? '♀' : '?');

        // Fotoğraf
        personGroups.append("image")
            .attr("x", -cardWidth/2 + 10)
            .attr("y", -cardHeight/2 + 26)
            .attr("width", 38)
            .attr("height", 38)
            .attr("href", d => d.data.data.fotograf || "")
            .attr("clip-path", d => `circle(19px at ${-cardWidth/2 + 29}px ${-cardHeight/2 + 45}px)`)
            .style("display", d => d.data.data.fotograf ? "block" : "none");

        // İsim ve detay metinleri
        const nameXOffset = d => d.data.data.fotograf ? -cardWidth/2 + 56 : 0;
        const alignOpts = d => d.data.data.fotograf ? "start" : "middle";

        personGroups.append("text")
            .attr("x", nameXOffset)
            .attr("y", -6)
            .attr("text-anchor", alignOpts)
            .attr("fill", "#1e293b")
            .attr("font-size", "14px")
            .attr("font-weight", "700")
            .attr("font-family", "'Inter', 'Segoe UI', sans-serif")
            .text(d => `${d.data.data.ad} ${d.data.data.soyad}`);
            
        personGroups.append("text")
            .attr("x", nameXOffset)
            .attr("y", 12)
            .attr("text-anchor", alignOpts)
            .attr("fill", "#6366f1")
            .attr("font-size", "11px")
            .attr("font-weight", "500")
            .attr("font-family", "'Inter', 'Segoe UI', sans-serif")
            .text(d => d.data.data.yakinlikDerecesi || "");

        personGroups.append("text")
            .attr("x", nameXOffset)
            .attr("y", 26)
            .attr("text-anchor", alignOpts)
            .attr("fill", "#94a3b8")
            .attr("font-size", "10px")
            .attr("font-family", "'Inter', 'Segoe UI', sans-serif")
            .text(d => d.data.data.dogumTarihi || "");

        // --- CONTEXT MENU & LINKING MODE ---
        personGroups.on("click", function(event, d) {
            event.stopPropagation();

            // Linking Mode aktifse: 2. kişi seçildi
            if (self.isLinkingMode && self._linkingSourcePerson) {
                const secondPerson = d.data.data;
                const firstPerson = self._linkingSourcePerson;

                if (firstPerson.id === secondPerson.id) {
                    alert('Aynı kişiyi seçemezsiniz.');
                    return;
                }

                self.cancelLinkingMode();
                if (self.callbacks.linkTwoPersons) {
                    self.callbacks.linkTwoPersons(firstPerson, secondPerson);
                }
                return;
            }

            // Normal mod: Context menü aç
            self.showContextMenu(event, d.data.data);
        });

        // --- DRAG & DROP (Çizgi Senkronizasyonu Dahil) ---
        const dragBehavior = d3.drag()
            .on("start", function(event) {
                d3.select(this).raise().classed("dragging", true);
            })
            .on("drag", function(event, d) {
                // Düğüm pozisyonunu güncelle
                d3.select(this).attr("transform", `translate(${event.x},${event.y})`);

                // _nodePositions map'ini güncelle
                self._nodePositions.set(d.data.id, {
                    x: event.x, y: event.y,
                    baseX: d.x, baseY: d.y
                });

                // Bağlı çizgileri (paths) EŞ ZAMANLI olarak yeniden hesapla
                self.g.select(".links-layer").selectAll("path.dag-link")
                    .attr("d", linkD => {
                        const srcPos = self._nodePositions.get(linkD.source.data.id);
                        const tgtPos = self._nodePositions.get(linkD.target.data.id);
                        if (srcPos && tgtPos) {
                            return self._lineFn([srcPos, tgtPos]);
                        }
                        return self._lineFn(linkD.points);
                    });
            })
            .on("end", function(event, d) {
                d3.select(this).classed("dragging", false);
                if (d.data.type === 'person') {
                    const ox = event.x - d.x;
                    const oy = event.y - d.y;
                    if (self.callbacks.onDragEnd) {
                        self.callbacks.onDragEnd(d.data.data.id, ox, oy);
                    }
                }
            });
        
        personGroups.call(dragBehavior);
    }
}
