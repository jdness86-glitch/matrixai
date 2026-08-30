import React from 'react';

const SOURCE_LABEL = { plug: 'prise', battery: 'batterie', rapl: 'CPU (RAPL)' };

export default function PowerBadge({ w, source, calibrated }) {
  if (w == null) return <span className="badge">— W</span>;
  if (source) return <span className="badge badge-real" title={`conso réelle via ${SOURCE_LABEL[source] || source}`}>⚡ {w.toFixed(1)} W · réel</span>;
  return <span className="badge" title={calibrated ? 'estimé (modèle auto-calibré)' : 'estimé (modèle par défaut, se calibrera avec des mesures réelles)'}>⚡ {w.toFixed?.(1) ?? w} W · est.</span>;
}
