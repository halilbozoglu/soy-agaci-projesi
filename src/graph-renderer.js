import * as d3dag from 'd3-dag';
import * as d3 from 'd3';

export class GraphRenderer {
    constructor(containerId) {
        this.containerId = containerId;
        const container = document.getElementById(containerId);
        container.innerHTML = "";
        
        this.svg = d3.select(container).append("svg")
            .style("width", "100%")
            .style("height", "100%")
            .style("min-height", "600px")
            .style("background-color", "#f8fafc");
        
        this.g = this.svg.append("g");
        
        this.zoom = d3.zoom().on("zoom", (e) => this.g.attr("transform", e.transform));
        this.svg.call(this.zoom);
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
        
        nodes.push({ id: DUMMY_ROOT_ID, type: 'dummy', data: {} });
        nodeIds.add(DUMMY_ROOT_ID); // Validasyondan geçmesi için Set'e ekle

        const parentMap = new Map();

        nodes.forEach(node => {
            if (node.id === DUMMY_ROOT_ID) {
                // Dummy Root'un parentIds dizisi kesinlikle boş olmalı
                parentMap.set(node.id, []);
                return;
            }

            // Düğümün hedeflendiği (target) linklerin kaynaklarını (source) bul
            let parents = links
                .filter(l => l.target === node.id)
                .map(l => l.source);

            // Kural 1: KUSURSUZ VERİ TEMİZLİĞİ (Sanitization)
            // Sadece fiziksel olarak dizide (nodes array) bulunan ID'lerin kalmasına izin ver.
            // Hayalet (dangling/undefined/null) ID'leri filtrele.
            parents = parents.filter(pId => pId && nodeIds.has(pId));

            parentMap.set(node.id, parents);
        });

        // Kural 2 & 3: DUMMY ROOT Güvenliği ve SINGLE NODE Bypass
        nodes.forEach(node => {
            if (node.id === DUMMY_ROOT_ID) return;

            const parents = parentMap.get(node.id);
            // Eğer düğümün hiçbir fiziksel/gerçek ebeveyni kalmadıysa, SADECE o zaman sanal köke bağla
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
            console.error("DAG Stratify Hatası (Topolojik Çökme engellendi):", error);
            // 0 veya 1 düğümlerde cycle dönme hatası varsa bypass edilecek
            return;
        }

        try {
            const layout = d3dag.sugiyama()
                .nodeSize(n => n.data && n.data.type === 'union' ? [60, 60] : [160, 180])
                .layering(d3dag.layeringSimplex())
                .decross(d3dag.decrossOpt())
                .coord(d3dag.coordQuad());
            
            layout(dagInfo);
        } catch(error) {
            console.error("DAG Layout Hatası:", error);
            return;
        }

        const line = d3.line()
            .curve(d3.curveMonotoneY)
            .x(d => d.x)
            .y(d => d.y);

        this.g.append("g")
            .selectAll("path")
            .data(dagInfo.links())
            .enter()
            .filter(d => d.source.data.id !== DUMMY_ROOT_ID) // Dummy çizgileri gizle
            .append("path")
            .attr("d", d => line(d.points))
            .attr("fill", "none")
            .attr("stroke", "#94a3b8")
            .attr("stroke-width", 2);

        const nodeGroup = this.g.append("g")
            .selectAll("g")
            .data(dagInfo.nodes())
            .enter()
            .filter(d => d.data.id !== DUMMY_ROOT_ID) // Dummy nodunu gizle
            .append("g")
            .attr("transform", d => `translate(${d.x},${d.y})`);

        nodeGroup.filter(d => d.data.type === 'union')
            .append("circle")
            .attr("r", 10)
            .attr("fill", "#ec4899")
            .attr("stroke", "#ffffff")
            .attr("stroke-width", 2)
            .style("cursor", "pointer")
            .on("click", (e, d) => console.log("Union clicked:", d.data.data));

        const personGroups = nodeGroup.filter(d => d.data.type === 'person');

        const cardWidth = 140;
        const cardHeight = 80;

        personGroups.append("rect")
            .attr("x", -cardWidth/2)
            .attr("y", -cardHeight/2)
            .attr("width", cardWidth)
            .attr("height", cardHeight)
            .attr("rx", 12)
            .attr("fill", "white")
            .attr("stroke", "#cbd5e1")
            .attr("stroke-width", 2)
            .attr("class", "shadow-md transition-all hover:stroke-blue-500 cursor-pointer");

        personGroups.append("image")
            .attr("x", -cardWidth/2 + 10)
            .attr("y", -cardHeight/2 + 20)
            .attr("width", 40)
            .attr("height", 40)
            .attr("href", d => d.data.data.fotograf || "")
            // basit bir dairesel clip-path ekleyelim
            .attr("clip-path", d => `circle(20px at ${-cardWidth/2 + 30}px ${-cardHeight/2 + 40}px)`)
            .style("display", d => d.data.data.fotograf ? "block" : "none");

        // İsim x ofseti
        const nameXOffset = d => d.data.data.fotograf ? -cardWidth/2 + 60 : 0;
        const alignOpts = d => d.data.data.fotograf ? "start" : "middle";

        personGroups.append("text")
            .attr("x", nameXOffset)
            .attr("y", -10)
            .attr("text-anchor", alignOpts)
            .attr("fill", "#0f172a")
            .attr("font-size", "14px")
            .attr("font-weight", "600")
            .text(d => `${d.data.data.ad} ${d.data.data.soyad}`);
            
        personGroups.append("text")
            .attr("x", nameXOffset)
            .attr("y", 10)
             .attr("text-anchor", alignOpts)
            .attr("fill", "#64748b")
            .attr("font-size", "12px")
            .text(d => d.data.data.yakinlikDerecesi || "Bilinmiyor");

        personGroups.append("text")
            .attr("x", nameXOffset)
            .attr("y", 25)
             .attr("text-anchor", alignOpts)
            .attr("fill", "#94a3b8")
            .attr("font-size", "11px")
            .text(d => d.data.data.dogumTarihi || "");
    }
}
