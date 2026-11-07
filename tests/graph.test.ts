import { describe, expect, it } from 'vitest';
import { buildGraph } from '../src/graph/build';
import { defaults, type Params } from '../src/params/schema';
import type { CellGraph } from '../src/graph/types';

function params(over: Params): Params {
  return { ...defaults(), 'graph.cells': 1200, ...over };
}

function checkGraph(g: CellGraph, areaTol: number) {
  let total = 0;
  for (let i = 0; i < g.n; i++) total += g.area[i];
  expect(Math.abs(total - g.W * g.H) / (g.W * g.H)).toBeLessThan(areaTol);
  // symmetric adjacency, no self loops
  for (let i = 0; i < g.n; i++) {
    for (let k = g.nbrOff[i]; k < g.nbrOff[i + 1]; k++) {
      const j = g.nbr[k];
      expect(j).not.toBe(i);
      let found = false;
      for (let q = g.nbrOff[j]; q < g.nbrOff[j + 1]; q++) if (g.nbr[q] === i) found = true;
      expect(found).toBe(true);
    }
  }
  // cellAt finds most cells at their own centroid
  let hits = 0;
  for (let i = 0; i < g.n; i++) if (g.cellAt(g.x[i], g.y[i]) === i) hits++;
  expect(hits / g.n).toBeGreaterThan(0.95);
}

describe('cell graphs', () => {
  it('voronoi (poisson) partitions the map', () => {
    const g = buildGraph(params({ 'graph.type': 'voronoi' }), 11);
    expect(g.n).toBeGreaterThan(900);
    checkGraph(g, 1e-9);
    // interior Voronoi cells average ~6 neighbours
    expect(g.nbr.length / g.n).toBeGreaterThan(5.2);
    expect(g.nbr.length / g.n).toBeLessThan(6.2);
  });
  it('voronoi with centroid corners and Lloyd still partitions', () => {
    const g = buildGraph(params({ 'graph.type': 'voronoi', 'vor.corner': 'centroid', 'pts.lloyd': 2, 'pts.method': 'uniform' }), 3);
    checkGraph(g, 1e-9);
  });
  it('hex lattice with zero jitter gives hexagons', () => {
    const g = buildGraph(params({ 'graph.type': 'voronoi', 'pts.method': 'jitter-hex', 'pts.jitter': 0 }), 3);
    let six = 0;
    for (let i = 0; i < g.n; i++) if (!g.border[i] && g.nbrOff[i + 1] - g.nbrOff[i] === 6) six++;
    let interior = 0;
    for (let i = 0; i < g.n; i++) if (!g.border[i]) interior++;
    expect(six / interior).toBeGreaterThan(0.99);
  });
  it('square, hex and triangle grids', () => {
    for (const type of ['square', 'hex', 'tri']) {
      const g = buildGraph(params({ 'graph.type': type }), 1);
      checkGraph(g, 1e-9);
      const expectDeg = type === 'square' ? 4 : type === 'hex' ? 6 : 3;
      let ok = 0;
      let interior = 0;
      for (let i = 0; i < g.n; i++) {
        if (g.border[i]) continue;
        interior++;
        if (g.nbrOff[i + 1] - g.nbrOff[i] === expectDeg) ok++;
      }
      expect(ok / interior).toBeGreaterThan(0.99);
    }
  });
  it('implicit cells under several metrics', () => {
    for (const metric of ['L2', 'L1', 'Linf', 'Lp']) {
      const g = buildGraph(params({ 'graph.type': 'implicit', 'imp.metric': metric, 'imp.res': 300 }), 5);
      checkGraph(g, 1e-9);
      expect(g.nbr.length / g.n).toBeGreaterThan(4);
    }
  });
  it('weighted & warped implicit cells build', () => {
    const g = buildGraph(params({ 'graph.type': 'implicit', 'imp.weights': 'multiplicative', 'imp.warpAmp': 0.6, 'imp.res': 300 }), 5);
    expect(g.n).toBeGreaterThan(900);
  });
});
