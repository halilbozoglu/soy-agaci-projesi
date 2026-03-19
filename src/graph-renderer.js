import * as d3dag from 'd3-dag';
import * as d3 from 'd3';

export class GraphRenderer {
    constructor(containerId, callbacks) {
        this.containerId = containerId;
        this.callbacks = callbacks || {};

        // --- FSM Linking State ---
        this.linkingState = null; // null | 'SPOUSE' | 'CHILD' | 'SIBLING'
        this._linkingSourcePerson = null;
        this._linkingTargetUnionId = null; // CHILD/SIBLING modları için hedef union

        const container = document.getElementById(containerId);
        container.innerHTML = "";
        
        this.svg = d3.select(container).append("svg")
            .attr("id", "dag-svg")
            .style("width", "100%")
            .style("height", "100%")
            .style("min-height", "600px");
        
        // SVG Defs
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

        // Linking mode hover glow
        const linkGlow = defs.append("filter")
            .attr("id", "linking-glow")
            .attr("x", "-30%").attr("y", "-30%")
            .attr("width", "160%").attr("height", "160%");
        linkGlow.append("feGaussianBlur")
            .attr("stdDeviation", "4")
            .attr("result", "blur");
        const lgMerge = linkGlow.append("feMerge");
        lgMerge.append("feMergeNode").attr("in", "blur");
        lgMerge.append("feMergeNode").attr("in", "SourceGraphic");

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
            if (this.linkingState) this.cancelLinkingMode();
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.linkingState) this.cancelLinkingMode();
        });

        this._nodePositions = new Map();
        this._linkData = [];
    }

    // --- Linking Mode API (FSM) ---
    get isLinkingMode() { return this.linkingState !== null; }

    enterLinkingMode(sourcePerson, mode, targetUnionId) {
        this.linkingState = mode; // 'SPOUSE' | 'CHILD' | 'SIBLING'
        this._linkingSourcePerson = sourcePerson;
        this._linkingTargetUnionId = targetUnionId || null;

        const modeLabels = {
            'SPOUSE': '💍 Evlendirmek',
            'CHILD': '👶 Çocuk yapmak',
            'SIBLING': '🧑‍🤝‍🧑 Kardeş yapmak'
        };
        const label = modeLabels[mode] || 'Bağlamak';
        this.showToast(`🔗 "${sourcePerson.ad} ${sourcePerson.soyad}" → ${label} için 2. kişiyi ağaçtan seçin... (ESC ile iptal)`, 'linking');
        this.svg.style("cursor", "crosshair");

        // Linking modunda kişi kartlarına hover glow ekle
        this.g.selectAll(".node-type-person")
            .classed("linking-candidate", true);
    }

    cancelLinkingMode() {
        this.linkingState = null;
        this._linkingSourcePerson = null;
        this._linkingTargetUnionId = null;
        this.hideToast();
        this.svg.style("cursor", null);
        this.g.selectAll(".node-type-person")
            .classed("linking-candidate", false);
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
            { icon: '🧑‍🤝‍🧑', label: 'Kardeş Ekle', action: 'addSibling' },
            { icon: '💍', label: 'Eş/Partner Ekle', action: 'addPartner' },
            { sep: true },
            { icon: '🔗', label: 'Başkasıyla Evlendir', action: 'startLinkSpouse' },
            { icon: '🔗', label: 'Mevcut Kişiyi Çocuk Yap', action: 'startLinkChild' },
            { icon: '🔗', label: 'Mevcut Kişiyi Kardeş Yap', action: 'startLinkSibling' },
            { sep: true },
            { icon: '🗑️', label: 'Sil', action: 'delete', danger: true }
        ];

        items.forEach(item => {
            if (item.sep) {
                const sep = document.createElement('div');
                sep.className = 'ctx-menu-sep';
                menu.appendChild(sep);
                return;
            }
            const btn = document.createElement('button');
            btn.className = `ctx-menu-item ${item.danger ? 'ctx-menu-danger' : ''}`;
            btn.innerHTML = `<span>${item.icon}</span><span>${item.label}</span>`;
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.hideContextMenu();
                // FSM Linking butonları
                if (item.action === 'startLinkSpouse' || item.action === 'startLinkChild' || item.action === 'startLinkSibling') {
                    if (this.callbacks.startLinkingFSM) {
                        this.callbacks.startLinkingFSM(personData, item.action, event);
                    }
                } else if (this.callbacks[item.action]) {
                    if (this.callbacks._setLastEvent) this.callbacks._setLastEvent(event);
                    this.callbacks[item.action](personData, event);
                }
            });
            menu.appendChild(btn);
        });

        const container = document.getElementById(this.containerId);
        container.appendChild(menu);

        const containerRect = container.getBoundingClientRect();
        let left = event.clientX - containerRect.left + 10;
        let top = event.clientY - containerRect.top + 10;
        if (left + 200 > containerRect.width) left = left - 210;
        if (top + 350 > containerRect.height) top = top - 360;
        menu.style.left = `${left}px`;
        menu.style.top = `${top}px`;
    }

    showToast(message, type) {
        this.hideToast();
        const container = document.getElementById(this.containerId);
        const toast = document.createElement('div');
        toast.id = 'linking-toast';
        toast.className = `toast-notification ${type === 'linking' ? 'toast-linking' : ''} ${type === 'error' ? 'toast-error' : ''}`;
        toast.innerHTML = `<span>${message}</span><button class="toast-close" onclick="this.parentElement.remove()">✕</button>`;
        container.appendChild(toast);
        if (type === 'error') setTimeout(() => this.hideToast(), 4000);
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
        if (person.cinsiyet === 'Erkek') return '#60a5fa';
        if (person.cinsiyet === 'Kadın') return '#f472b6';
        return '#94a3b8';
    }
    // --- CUBIC BÉZIER ÇIZGI FORMÜLÜ ---
    _bezierPath(source, target) {
        const midY = (source.y + target.y) / 2;
        return `M${source.x},${source.y} C${source.x},${midY} ${target.x},${midY} ${target.x},${target.y}`;
    }

    _getNameColor(person) {
        if (person.cinsiyet === 'Erkek') return '#2563eb';
        if (person.cinsiyet === 'Kadın') return '#db2777';
        return '#475569';
    }

    render(dataManager) {
        this.g.selectAll("*").remove();
        this._nodePositions.clear();

        const data = dataManager.data;
        if (data.persons.length === 0) return;

        // --- 1. DETERMİNİSTİK SIRALAMA ---
        const nodes = [];
        [...data.persons].sort((a, b) => a.id.localeCompare(b.id)).forEach(p => {
            nodes.push({ id: `p_${p.id}`, type: 'person', data: p });
        });
        [...data.unions].sort((a, b) => a.id.localeCompare(b.id)).forEach(u => {
            nodes.push({ id: `u_${u.id}`, type: 'union', data: u });
        });

        const links = [];
        [...data.unions].sort((a, b) => a.id.localeCompare(b.id)).forEach(u => {
            const uId = `u_${u.id}`;
            [...u.partnerIds].sort().forEach(pId => {
                links.push({ source: `p_${pId}`, target: uId });
            });
            [...u.childrenIds].sort().forEach(cId => {
                links.push({ source: uId, target: `p_${cId}` });
            });
        });

        // --- SANAL KÖK ---
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
        // Deterministik sıralama: nodes'u id'ye göre sırala
        nodes.sort((a, b) => a.id.localeCompare(b.id));
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
                    if (n.data.type === 'union' || n.data.type === 'dummy') return [30, 80];
                    return [220, 120];
                })
                .layering(d3dag.layeringSimplex())
                .decross(d3dag.decrossTwoLayer())
                .coord(d3dag.coordQuad());
            layout(dagInfo);
        } catch(error) {
            console.error("DAG Layout Hatası:", error);
            return;
        }

        // --- KALICI OFFSET UYGULAMA ---
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
            .attr("data-source", d => d.source.data.id)
            .attr("data-target", d => d.target.data.id)
            .attr("d", d => {
                const srcPos = this._nodePositions.get(d.source.data.id);
                const tgtPos = this._nodePositions.get(d.target.data.id);
                if (srcPos && tgtPos) return this._bezierPath(srcPos, tgtPos);
                // Fallback: d.points varsa ilk ve son noktayı kullan
                if (d.points && d.points.length >= 2) return this._bezierPath(d.points[0], d.points[d.points.length - 1]);
                return '';
            })
            .attr("fill", "none")
            .attr("stroke", "#94a3b8")
            .attr("stroke-width", 2)
            .attr("stroke-opacity", 0.35);

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

        // Union düğümleri
        const unionGroups = nodeGroup.filter(d => d.data.type === 'union');
        unionGroups.append("circle")
            .attr("r", 6)
            .attr("fill", "white")
            .attr("stroke", "#e2e8f0")
            .attr("stroke-width", 1.5)
            .attr("opacity", 0.8)
            .style("cursor", "default");

        // Person düğümleri
        const personGroups = nodeGroup.filter(d => d.data.type === 'person');
        const cardWidth = 170;
        const cardHeight = 90;
        const self = this;

        personGroups.append("rect")
            .attr("class", "card-bg")
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

        personGroups.append("circle")
            .attr("cx", -cardWidth/2 + 14).attr("cy", -cardHeight/2 + 14).attr("r", 8)
            .attr("fill", d => d.data.data.cinsiyet === 'Erkek' ? '#3b82f6' : d.data.data.cinsiyet === 'Kadın' ? '#ec4899' : '#94a3b8')
            .attr("opacity", 0.8);
        personGroups.append("text")
            .attr("x", -cardWidth/2 + 14).attr("y", -cardHeight/2 + 14)
            .attr("text-anchor", "middle").attr("dy", "0.35em").attr("fill", "white").attr("font-size", "9px")
            .text(d => d.data.data.cinsiyet === 'Erkek' ? '♂' : d.data.data.cinsiyet === 'Kadın' ? '♀' : '?');

        personGroups.append("image")
            .attr("x", -cardWidth/2 + 10).attr("y", -cardHeight/2 + 26)
            .attr("width", 38).attr("height", 38)
            .attr("href", d => d.data.data.fotograf || "")
            .attr("clip-path", d => `circle(19px at ${-cardWidth/2 + 29}px ${-cardHeight/2 + 45}px)`)
            .style("display", d => d.data.data.fotograf ? "block" : "none");

        const nameXOffset = d => d.data.data.fotograf ? -cardWidth/2 + 56 : 0;
        const alignOpts = d => d.data.data.fotograf ? "start" : "middle";

        personGroups.append("text")
            .attr("x", nameXOffset).attr("y", -6)
            .attr("text-anchor", alignOpts)
            .attr("fill", d => self._getNameColor(d.data.data))
            .attr("font-size", "14px").attr("font-weight", "700")
            .attr("font-family", "'Inter', 'Segoe UI', sans-serif")
            .text(d => `${d.data.data.ad} ${d.data.data.soyad}`);
            
        personGroups.append("text")
            .attr("x", nameXOffset).attr("y", 12)
            .attr("text-anchor", alignOpts).attr("fill", "#6366f1")
            .attr("font-size", "11px").attr("font-weight", "500")
            .attr("font-family", "'Inter', 'Segoe UI', sans-serif")
            .text(d => d.data.data.yakinlikDerecesi || "");

        personGroups.append("text")
            .attr("x", nameXOffset).attr("y", 26)
            .attr("text-anchor", alignOpts).attr("fill", "#94a3b8")
            .attr("font-size", "10px")
            .attr("font-family", "'Inter', 'Segoe UI', sans-serif")
            .text(d => d.data.data.dogumTarihi || "");

        // --- HOVER: Bağlı çizgiler parlasın + Linking mode glow ---
        personGroups.on("mouseenter", function(event, d) {
            const nodeId = d.data.id;
            linksLayer.selectAll("path.dag-link")
                .attr("stroke-opacity", linkD => (linkD.source.data.id === nodeId || linkD.target.data.id === nodeId) ? 1 : 0.12)
                .attr("stroke", linkD => (linkD.source.data.id === nodeId || linkD.target.data.id === nodeId) ? '#ffffff' : '#94a3b8')
                .attr("stroke-width", linkD => (linkD.source.data.id === nodeId || linkD.target.data.id === nodeId) ? 3 : 2);

            // Linking mode: yeşil glow
            if (self.linkingState && self._linkingSourcePerson && self._linkingSourcePerson.id !== d.data.data.id) {
                d3.select(this).select(".card-bg")
                    .attr("stroke", "#22c55e")
                    .attr("stroke-width", 3)
                    .style("filter", "url(#linking-glow)");
            }
        });
        personGroups.on("mouseleave", function(event, d) {
            linksLayer.selectAll("path.dag-link")
                .attr("stroke-opacity", 0.35)
                .attr("stroke", "#94a3b8")
                .attr("stroke-width", 2);

            // Linking glow reset
            if (self.linkingState) {
                d3.select(this).select(".card-bg")
                    .attr("stroke", self._getCardStroke(d.data.data))
                    .attr("stroke-width", 2)
                    .style("filter", "url(#card-shadow)");
            }
        });

        // --- CLICK: Context Menu vs Linking Mode (İZOLE) ---
        personGroups.on("click", function(event, d) {
            event.stopPropagation();

            // Linking Mode aktifse: context menu AÇILMAZ
            if (self.linkingState && self._linkingSourcePerson) {
                const secondPerson = d.data.data;
                const firstPerson = self._linkingSourcePerson;
                if (firstPerson.id === secondPerson.id) {
                    self.showToast('⚠️ Aynı kişiyi seçemezsiniz.', 'error');
                    return;
                }
                const currentState = self.linkingState;
                const targetUnionId = self._linkingTargetUnionId;
                self.cancelLinkingMode();

                if (self.callbacks.onLinkingComplete) {
                    self.callbacks.onLinkingComplete(firstPerson, secondPerson, currentState, targetUnionId);
                }
                return;
            }

            // Normal mod: Context menü aç
            self.showContextMenu(event, d.data.data);
        });

        // --- DRAG & DROP (subject bazlı dx/dy akümülasyon) ---
        const dragBehavior = d3.drag()
            .filter(function(event) {
                if (self.linkingState) return false;
                return !event.ctrlKey && !event.button;
            })
            .subject(function(event, d) {
                // Mevcut pozisyonu subject olarak döndür → event.x/y buna göre hesaplanır
                const pos = self._nodePositions.get(d.data.id);
                return pos ? { x: pos.x, y: pos.y } : { x: d.x, y: d.y };
            })
            .on("start", function(event) {
                d3.select(this).raise().classed("dragging", true);
            })
            .on("drag", function(event, d) {
                // event.x/y artık subject'e göre doğru hesaplanıyor
                const newX = event.x;
                const newY = event.y;

                // 1. DOM: düğümü anında taşı
                d3.select(this).attr("transform", `translate(${newX},${newY})`);

                // 2. Pozisyon map'ini güncelle
                self._nodePositions.set(d.data.id, {
                    x: newX, y: newY,
                    baseX: d.x, baseY: d.y
                });

                // 3. Bağlı çizgileri eş zamanlı güncelle (Bézier)
                self.g.select(".links-layer").selectAll("path.dag-link")
                    .attr("d", linkD => {
                        const srcPos = self._nodePositions.get(linkD.source.data.id);
                        const tgtPos = self._nodePositions.get(linkD.target.data.id);
                        if (srcPos && tgtPos) return self._bezierPath(srcPos, tgtPos);
                        if (linkD.points && linkD.points.length >= 2) return self._bezierPath(linkD.points[0], linkD.points[linkD.points.length - 1]);
                        return '';
                    });
            })
            .on("end", function(event, d) {
                d3.select(this).classed("dragging", false);
                if (d.data.type === 'person') {
                    // Offset = nihai pozisyon - sugiyama base pozisyonu
                    const pos = self._nodePositions.get(d.data.id);
                    const ox = pos ? pos.x - pos.baseX : 0;
                    const oy = pos ? pos.y - pos.baseY : 0;
                    if (self.callbacks.onDragEnd) {
                        self.callbacks.onDragEnd(d.data.data.id, ox, oy);
                    }
                }
            });
        
        personGroups.call(dragBehavior);
    }
}
