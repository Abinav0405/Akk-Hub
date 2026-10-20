/**
 * Face mesh for the Face ID camera screen: turns face-api's 68 landmarks into a triangulated
 * mesh (Delaunay), with extra forehead and cheek points so it covers the whole face.
 * Purely visual — matching uses the face descriptor, not this mesh.
 */

/** 68 landmarks + forehead (above each brow) + cheek points (between jaw and nose tip). */
export function buildMeshPoints(positions) {
    if (!positions || positions.length < 68) return [];
    const pts = positions.map((p) => ({ x: p.x, y: p.y }));
    const nose = pts[30];
    const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

    for (let i = 17; i <= 26; i += 1) {
        const brow = pts[i];
        pts.push({ x: brow.x + (brow.x - nose.x) * 0.4, y: brow.y + (brow.y - nose.y) * 0.4 });
    }
    for (let i = 1; i <= 15; i += 1) {
        pts.push(lerp(pts[i], nose, 0.45));
    }
    return pts;
}

function circumcircle(p, a, b, c) {
    const A = p[a];
    const B = p[b];
    const C = p[c];
    const d = 2 * (A.x * (B.y - C.y) + B.x * (C.y - A.y) + C.x * (A.y - B.y));
    if (Math.abs(d) < 1e-9) return { a, b, c, x: 0, y: 0, r2: Infinity };
    const a2 = A.x * A.x + A.y * A.y;
    const b2 = B.x * B.x + B.y * B.y;
    const c2 = C.x * C.x + C.y * C.y;
    const x = (a2 * (B.y - C.y) + b2 * (C.y - A.y) + c2 * (A.y - B.y)) / d;
    const y = (a2 * (C.x - B.x) + b2 * (A.x - C.x) + c2 * (B.x - A.x)) / d;
    return { a, b, c, x, y, r2: (A.x - x) ** 2 + (A.y - y) ** 2 };
}

/**
 * Bowyer–Watson Delaunay triangulation (fine for ~100 points at camera frame rate).
 * @returns {Array<[number, number, number]>} triangles as point indices
 */
export function delaunay(points) {
    const n = points.length;
    if (n < 3) return [];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of points) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
    }
    const d = Math.max(maxX - minX, maxY - minY) * 20 || 1;
    const mx = (minX + maxX) / 2;
    const my = (minY + maxY) / 2;
    const pts = points.concat([
        { x: mx - d, y: my - d },
        { x: mx, y: my + d },
        { x: mx + d, y: my - d },
    ]);

    let tris = [circumcircle(pts, n, n + 1, n + 2)];
    for (let i = 0; i < n; i += 1) {
        const p = pts[i];
        const bad = [];
        const keep = [];
        for (const t of tris) {
            if ((p.x - t.x) ** 2 + (p.y - t.y) ** 2 < t.r2) bad.push(t);
            else keep.push(t);
        }
        // The hole's boundary = edges used by exactly one bad triangle.
        const edges = new Map();
        for (const t of bad) {
            for (const [u, v] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]]) {
                const key = u < v ? `${u}-${v}` : `${v}-${u}`;
                edges.set(key, edges.has(key) ? null : [u, v]);
            }
        }
        for (const e of edges.values()) {
            if (e) keep.push(circumcircle(pts, e[0], e[1], i));
        }
        tris = keep;
    }
    return tris.filter((t) => t.a < n && t.b < n && t.c < n).map((t) => [t.a, t.b, t.c]);
}

/** Unique edges of a triangulation, for drawing each line once. */
export function meshEdges(triangles) {
    const seen = new Set();
    const edges = [];
    for (const [a, b, c] of triangles) {
        for (const [u, v] of [[a, b], [b, c], [c, a]]) {
            const key = u < v ? `${u}-${v}` : `${v}-${u}`;
            if (!seen.has(key)) {
                seen.add(key);
                edges.push([u, v]);
            }
        }
    }
    return edges;
}

/**
 * Triangles for drawing: Delaunay also fills the convex hull with long, thin slivers that
 * reach across the face (and look like stray lines), so drop any triangle with an edge longer
 * than a third of the face width.
 */
export function faceTriangles(points) {
    if (points.length < 17) return [];
    const faceWidth = Math.hypot(points[16].x - points[0].x, points[16].y - points[0].y) || 1;
    const maxEdge = faceWidth * 0.33;
    const len = (a, b) => Math.hypot(points[a].x - points[b].x, points[a].y - points[b].y);
    return delaunay(points).filter(([a, b, c]) => len(a, b) <= maxEdge && len(b, c) <= maxEdge && len(c, a) <= maxEdge);
}
