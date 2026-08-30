import React from 'react';
export const Card=({children,className=''})=><div className={`card ${className}`}>{children}</div>;
export const Stat=({label,value,unit,v,sub})=>{const val=v??value;return <div className="stat"><div className="v">{val}{unit&&<span style={{fontSize:'.75em',color:'var(--muted)'}}> {unit}</span>}</div><div className="l">{label}</div>{sub&&<div className="muted" style={{fontSize:'.7rem'}}>{sub}</div>}</div>};
export const Button=({children,onClick,className='',variant='primary'})=><button onClick={onClick} className={`button ${variant==='secondary'?'secondary':''} ${className}`}>{children}</button>;
export const Badge=({children,variant='default'})=>{
  const m={default:{bg:'#ecfdf5',c:'#047857'},success:{bg:'#dcfce7',c:'#166534'},danger:{bg:'#fef2f2',c:'#dc2626'},warning:{bg:'#fef9c3',c:'#a16207'}}[variant]||{bg:'#ecfdf5',c:'#047857'};
  return <span style={{background:m.bg,color:m.c,padding:'4px 10px',borderRadius:99,fontSize:'.75rem',fontWeight:600}}>{children}</span>;
};
export function Chart({ title, data, scale = 1 }) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !data) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(280, canvas.clientWidth || 300), height = 96;
    canvas.width = width * ratio; canvas.height = height * ratio;
    const ctx = canvas.getContext('2d'); ctx.scale(ratio, ratio); ctx.clearRect(0, 0, width, height);
    const values = data.map((v) => v == null ? null : v * scale);
    const available = values.filter((v) => Number.isFinite(v));
    const max = Math.max(...available, 1), sx = width / (values.length - 1 || 1);
    ctx.strokeStyle = '#45e0a8'; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.beginPath();
    let started = false;
    values.forEach((v, i) => { if (v == null) return; const x = i * sx, y = height - 5 - (v / max) * (height - 12); if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y); });
    ctx.stroke();
  });
  const last = data?.filter((v) => v != null).at(-1);
  return <figure style={{ margin: 0 }}><figcaption style={{ fontSize: '.8rem', color: 'var(--muted)', marginBottom: 6 }}>{title}{last != null ? <strong style={{ color: 'var(--text)', float: 'right' }}>{(last * scale).toFixed(1)}</strong> : null}</figcaption><canvas ref={ref} role="img" aria-label={`${title}, dernière valeur ${last == null ? 'indisponible' : (last * scale).toFixed(1)}`} /></figure>;
}
export const push = (arr, val) => [...arr.slice(-59), val];
