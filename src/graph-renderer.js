import * as d3dag from 'd3-dag';
import * as d3 from 'd3';

export class GraphRenderer {
    constructor(containerId, callbacks) {
        this.containerId = containerId;
        this.callbacks = callbacks || {};
        const container = document.getElementById(containerId);
        container.innerHTML = "";
        
        this.svg = d3.select(container).append("svg")
            .attr("id", "dag-svg")
            .style("width", "100%")
            .style("height", "100%")
            .style("min-height", "600px")
            .style("background-color", "#f8fafc");
        
        this.g = this.svg.append("g").attr("id", "zoom-group");
        
        // --- 1. SMOOTH PAN & ZOOM ---
        this.zoom = d3.zoom()
            .scaleExtent([0.1, 4])
            .on("zoom", (e) => this.g.attr("transform", e.transform));
        
        this.svg.call(this.zoom);
        // Çift tıklama ile zoom-in engelle
        this.svg.on("dblclick.zoom", null);

        // SVG boşluğa tıklanınca context menu kapat
        this.svg.on("click", () => this.hideContextMenu());
    }

    hideContextMenu() {
        const existing = document.getElementById('node-context-menu');
        if (existing) existing.remove();
    }

    showContextMenu(event, personData) {
        this.hideContextMenu();

        const menu = document.createElement('div');
        menu.id = 'node-context-menu';
        menu.className = 'absolute bg-white rounded-lg shadow-2xl border border-slate-200 py-1 z-50 text-sm min-w-[160px]';
        
        const items = [
            { icon: '✏️', label: 'Düzenle', action: 'edit' },
            { icon: '👆', label: 'Ebeveyn Ekle', action: 'addParent' },
            { icon: '👶', label: 'Çocuk Ekle', action: 'addChild' },
            { icon: '🗑️', label: 'Sil', action: 'delete', danger: true }
        ];

        items.forEach(item => {
            const btn = document.createElement('button');
            btn.className = `w-full text-left px-4 py-2 hover:bg-slate-100 flex items-center gap-2 transition-colors ${item.danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-700'}`;
            btn.innerHTML = `<span>${item.icon}</span><span>${item.label}</span>`;
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.hideContextMenu();
                if (this.callbacks[item.action]) {
                    this.callbacks[item.action](personData);
                }
            });
            menu.appendChild(btn);
        });

        const container = document.getElementById(this.containerId);
        container.appendChild(menu);

        // Menü pozisyonunu container'a göre hesapla
        const containerRect = container.getBoundingClientRect();
        let left = event.clientX - containerRect.left + 10;
        let top = event.clientY - containerRect.top + 10;

        // Ekran taşma kontrolü
        if (left + 170 > containerRect.width) left = left - 180;
        if (top + 160 > containerRect.height) top = top - 170;

        menu.style.left = `${left}px`;
        menu.style.top = `${top}px`;
    }

    render(dataManager) {
        this.g.selectAll("*").remove();

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

        // --- VERİ TEMİZLİĞİ VE SANAL KÖK (DUMMY ROOT) GÜVENLİĞİ ---
        const nodeIds = new Set(nodes.map(n => n.id));
        const DUMMY_ROOT_ID = 'virtual_dummy_root';
        
        nodes.push({ id: DUMMY_ROOT_ID, type: 'dummy', data: { ad: '', soyad: '', cinsiyet: '', dogumTarihi: '', yakinlikDerecesi: '', fotograf: null } });
        nodeIds.add(DUMMY_ROOT_ID);

        const parentMap = new Map();

        nodes.forEach(node => {
            if (node.id === DUMMY_ROOT_ID) {
                parentMap.set(node.id, []);
                return;
            }
            let parents = links
                .filter(l => l.target === node.id)
                .map(l => l.source);
            parents = parents.filter(pId => pId && nodeIds.has(pId));
            parentMap.set(node.id, parents);
        });

        nodes.forEach(node => {
            if (node.id === DUMMY_ROOT_ID) return;
            const parents = parentMap.get(node.id);
            if (parents.length === 0) {
                parents.push(DUMMY_ROOT_ID);
            }
        });

        let dagInfo;
        try {
            const builder = d3dag.dagStratify()
                .id(d => d.id)
                .parentIds(d => parentMap.get(d.id));
            dagInfo = builder(nodes);
        } catch (error) {
            console.error("DAG Stratify Hatası:", error);
            return;
        }

        try {
            const layout = d3dag.sugiyama()
                .nodeSize(n => {
                    if (!n || !n.data) return [0, 0];
                    return n.data.type === 'union' ? [60, 60] : [180, 200];
                })
                .layering(d3dag.layeringSimplex())
                .decross(d3dag.decrossOpt())
                .coord(d3dag.coordQuad());
            layout(dagInfo);
        } catch(error) {
            console.error("DAG Layout Hatası:", error);
            return;
        }

        // --- LINK ÇİZİMİ ---
        const line = d3.line()
            .curve(d3.curveMonotoneY)
            .x(d => d.x)
            .y(d => d.y);

        this.g.append("g").attr("class", "links-layer")
            .selectAll("path")
            .data(dagInfo.links())
            .enter()
            .filter(d => d.source.data.id !== DUMMY_ROOT_ID)
            .append("path")
            .attr("d", d => line(d.points))
            .attr("fill", "none")
            .attr("stroke", "#94a3b8")
            .attr("stroke-width", 2);

        // --- DÜĞÜM ÇİZİMİ ---
        const allDescendants = dagInfo.descendants();

        const nodeGroup = this.g.append("g").attr("class", "nodes-layer")
            .selectAll("g")
            .data(allDescendants)
            .enter()
            .filter(d => d.data.id !== DUMMY_ROOT_ID)
            .append("g")
            .attr("class", d => `node-group node-type-${d.data.type}`)
            .attr("transform", d => {
                // --- 2. DRAG OFFSET UYGULA ---
                const ox = (d.data.type === 'person' && d.data.data.offsetX) || 0;
                const oy = (d.data.type === 'person' && d.data.data.offsetY) || 0;
                return `translate(${d.x + ox},${d.y + oy})`;
            });

        // --- UNION düğümleri ---
        nodeGroup.filter(d => d.data.type === 'union')
            .append("circle")
            .attr("r", 10)
            .attr("fill", "#ec4899")
            .attr("stroke", "#ffffff")
            .attr("stroke-width", 2)
            .style("cursor", "pointer");

        // --- PERSON düğümleri ---
        const personGroups = nodeGroup.filter(d => d.data.type === 'person');
        const cardWidth = 150;
        const cardHeight = 85;
        const self = this;

        // Kart arka planı
        personGroups.append("rect")
            .attr("x", -cardWidth/2)
            .attr("y", -cardHeight/2)
            .attr("width", cardWidth)
            .attr("height", cardHeight)
            .attr("rx", 12)
            .attr("fill", "white")
            .attr("stroke", "#cbd5e1")
            .attr("stroke-width", 2)
            .style("cursor", "pointer")
            .style("filter", "drop-shadow(0 2px 4px rgba(0,0,0,0.08))");

        // Fotoğraf
        personGroups.append("image")
            .attr("x", -cardWidth/2 + 8)
            .attr("y", -cardHeight/2 + 18)
            .attr("width", 40)
            .attr("height", 40)
            .attr("href", d => d.data.data.fotograf || "")
            .attr("clip-path", d => `circle(20px at ${-cardWidth/2 + 28}px ${-cardHeight/2 + 38}px)`)
            .style("display", d => d.data.data.fotograf ? "block" : "none");

        // İsim
        const nameXOffset = d => d.data.data.fotograf ? -cardWidth/2 + 56 : 0;
        const alignOpts = d => d.data.data.fotograf ? "start" : "middle";

        personGroups.append("text")
            .attr("x", nameXOffset)
            .attr("y", -10)
            .attr("text-anchor", alignOpts)
            .attr("fill", "#0f172a")
            .attr("font-size", "13px")
            .attr("font-weight", "600")
            .text(d => `${d.data.data.ad} ${d.data.data.soyad}`);
            
        personGroups.append("text")
            .attr("x", nameXOffset)
            .attr("y", 8)
            .attr("text-anchor", alignOpts)
            .attr("fill", "#64748b")
            .attr("font-size", "11px")
            .text(d => d.data.data.yakinlikDerecesi || "");

        personGroups.append("text")
            .attr("x", nameXOffset)
            .attr("y", 22)
            .attr("text-anchor", alignOpts)
            .attr("fill", "#94a3b8")
            .attr("font-size", "10px")
            .text(d => d.data.data.dogumTarihi || "");

        // --- 3. CONTEXT MENU (Tıklama ile açılan Hızlı İşlem Menüsü) ---
        personGroups.on("click", function(event, d) {
            event.stopPropagation();
            self.showContextMenu(event, d.data.data);
        });

        // --- 2. D3 DRAG & DROP ---
        const dragBehavior = d3.drag()
            .on("start", function(event) {
                d3.select(this).raise().classed("dragging", true);
            })
            .on("drag", function(event, d) {
                d3.select(this).attr("transform", `translate(${event.x},${event.y})`);
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
