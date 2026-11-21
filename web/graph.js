const ROLE_COLORS = {
  coordinator: '#38e8ff',
  architect: '#a78bfa',
  researcher: '#38bdf8',
  author: '#34d399',
  committer: '#2dd4bf',
  reviewer: '#f472b6',
  verifier: '#fb7185',
  release: '#fbbf24',
  digital_twin: '#818cf8',
  monitor: '#94a3b8',
  human: '#60a5fa',
  gitlab: '#fb923c'
};

export function colorForNode(id, role) {
  if (id === 'gitlab') return ROLE_COLORS.gitlab;
  return Object.hasOwn(ROLE_COLORS, role) ? ROLE_COLORS[role] : '#38e8ff';
}

/**
 * Render interactive SVG directed collaboration topology graph with weighted @mention edges,
 * @all dashed arcs, and active speaker pulse ring.
 */
export function renderCollaborationGraph(svgEl, graphData, { hideInactive = false } = {}) {
  const width = 920;
  const height = 360;
  svgEl.setAttribute('viewBox', `0 0 ${width} ${height}`);

  const visibleNodes = (graphData.nodes || []).filter((n) => !hideInactive || n.activeInSlice);
  if (visibleNodes.length === 0) {
    svgEl.innerHTML = `<text x="${width / 2}" y="${height / 2}" fill="#64748b" text-anchor="middle" font-size="14">暂无协作节点数据</text>`;
    return;
  }

  // Deterministic clean layered layout so node pills NEVER overlap
  const positions = computeLayeredLayout(visibleNodes, width, height);
  const posMap = new Map(positions.map((p) => [p.id, p]));
  const activeAuthor = graphData.currentMessage?.author || null;

  const defs = `
    <defs>
      <marker id="arrow-direct" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 1 L 10 5 L 0 9 z" fill="#cbd5e1"></path>
      </marker>
      <marker id="arrow-all" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 1 L 10 5 L 0 9 z" fill="#fbbf24"></path>
      </marker>
    </defs>`;

  const edgeSvg = [];
  for (const edge of graphData.edges || []) {
    const a = posMap.get(edge.from);
    const b = posMap.get(edge.to);
    if (!a || !b) continue;

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist;
    const uy = dy / dist;

    // Offset endpoints to node pill perimeter
    const padStart = 58;
    const padEnd = 62;
    const sx = a.x + ux * Math.min(padStart, dist * 0.35);
    const sy = a.y + uy * Math.min(24, dist * 0.35);
    const ex = b.x - ux * Math.min(padEnd, dist * 0.35);
    const ey = b.y - uy * Math.min(24, dist * 0.35);

    // Slight curve perpendicular to edge so bi-directional A<->B arrows separate cleanly
    const curve = edge.viaAll ? 34 : 20;
    const cx = (sx + ex) / 2 - uy * curve;
    const cy = (sy + ey) / 2 + ux * curve;
    const strokeW = Math.min(5, 1.4 + edge.count * 0.75);
    const isCurrentEdge = edge.lastSeq === graphData.currentMessage?.seq;
    const strokeCol = edge.viaAll ? '#fbbf24' : isCurrentEdge ? '#38e8ff' : 'rgba(203, 213, 225, 0.72)';

    edgeSvg.push(`
      <g class="g-edge">
        <path d="M ${sx.toFixed(1)} ${sy.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}"
              fill="none"
              stroke="${strokeCol}"
              stroke-width="${strokeW.toFixed(1)}"
              ${edge.viaAll ? 'stroke-dasharray="5 5"' : ''}
              marker-end="url(#${edge.viaAll ? 'arrow-all' : 'arrow-direct'})" />
        <circle cx="${((sx + 2 * cx + ex) / 4).toFixed(1)}" cy="${((sy + 2 * cy + ey) / 4).toFixed(1)}" r="10" fill="#0d1320" stroke="${strokeCol}" stroke-width="1" />
        <text x="${((sx + 2 * cx + ex) / 4).toFixed(1)}" y="${(((sy + 2 * cy + ey) / 4) + 3.5).toFixed(1)}"
              fill="#e2e8f0" font-size="10" font-family="monospace" text-anchor="middle">${edge.count}</text>
      </g>`);
  }

  const nodeSvg = [];
  for (const n of positions) {
    const col = colorForNode(n.id, n.role);
    const isSpeaker = n.id === activeAuthor;
    const opacity = n.activeInSlice ? 1 : 0.45;
    const pillW = Math.max(108, Math.min(152, n.id.length * 9 + 46));
    const pillH = 34;

    nodeSvg.push(`
      <g class="g-node" transform="translate(${n.x.toFixed(1)}, ${n.y.toFixed(1)})" opacity="${opacity}">
        ${
          isSpeaker
            ? `<rect x="${(-pillW / 2 - 5).toFixed(1)}" y="${(-pillH / 2 - 5).toFixed(1)}" width="${(pillW + 10).toFixed(1)}" height="${(pillH + 10).toFixed(1)}" rx="22" fill="none" stroke="${col}" stroke-width="2" stroke-opacity="0.65" />`
            : ''
        }
        <rect x="${(-pillW / 2).toFixed(1)}" y="${(-pillH / 2).toFixed(1)}" width="${pillW}" height="${pillH}" rx="17"
              fill="#0e1422" stroke="${isSpeaker ? col : 'rgba(148,163,184,0.45)'}"
              stroke-width="${isSpeaker ? 2.2 : 1.3}"
              ${n.state === 'waiting' && !isSpeaker ? 'stroke-dasharray="3 3"' : ''} />
        <circle cx="${(-pillW / 2 + 16).toFixed(1)}" cy="0" r="4.5" fill="${col}" />
        <text x="6" y="4.5" fill="#f1f5f9" font-size="12.5" font-weight="${isSpeaker ? '700' : '600'}" font-family="monospace" text-anchor="middle">${escapeXml(n.id)}</text>
      </g>`);
  }

  svgEl.innerHTML = `${defs}<g>${edgeSvg.join('')}</g><g>${nodeSvg.join('')}</g>`;
}

function computeLayeredLayout(nodes, width, height) {
  const top = [];
  const middle = [];
  const bottom = [];

  for (const n of nodes) {
    if (n.id === 'coordinator' || n.id === 'gitlab' || n.id === 'monitor' || n.role === 'human') {
      top.push(n);
    } else if (n.role === 'verifier' || n.role === 'release' || n.id === 'qa') {
      bottom.push(n);
    } else {
      middle.push(n);
    }
  }

  // Ensure coordinator stays centered in top row
  top.sort((a, b) => (a.id === 'coordinator' ? 0 : a.id === 'gitlab' ? -1 : 1) - (b.id === 'coordinator' ? 0 : b.id === 'gitlab' ? -1 : 1));

  const placeRow = (arr, y) => {
    const count = arr.length;
    if (count === 0) return [];
    const padX = 115;
    const span = Math.max(0, width - padX * 2);
    return arr.map((n, idx) => ({
      ...n,
      x: count === 1 ? width / 2 : padX + (span * idx) / (count - 1),
      y
    }));
  };

  if (middle.length === 0 && bottom.length === 0) {
    return placeRow(top, height / 2);
  }
  if (bottom.length === 0) {
    return [...placeRow(top, 82), ...placeRow(middle, 255)];
  }
  return [...placeRow(top, 64), ...placeRow(middle, 184), ...placeRow(bottom, 300)];
}

function escapeXml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
