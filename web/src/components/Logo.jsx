import React from 'react';
const S={small:28,medium:52,large:88};
export default function Logo({size='medium'}){
  const s=S[size]||52;
  return <div style={{width:s,height:s,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
    <svg viewBox="0 0 512 512" style={{width:'100%',height:'100%'}} fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="512" height="512" rx="120" fill="#0a0a0a"/>
      <circle cx="256" cy="200" r="70" stroke="#10b981" strokeWidth="16" fill="none"/>
      <circle cx="256" cy="200" r="25" fill="#10b981"/>
      <path d="M180 320H332V380H180V320Z" stroke="#10b981" strokeWidth="16" fill="none"/>
      <path d="M220 380V440H292V380" stroke="#10b981" strokeWidth="16" fill="none"/>
      <line x1="256" y1="130" x2="256" y2="80" stroke="#10b981" strokeWidth="12" strokeLinecap="round"/>
      <line x1="186" y1="150" x2="150" y2="110" stroke="#10b981" strokeWidth="12" strokeLinecap="round"/>
      <line x1="326" y1="150" x2="362" y2="110" stroke="#10b981" strokeWidth="12" strokeLinecap="round"/>
      <line x1="166" y1="200" x2="116" y2="200" stroke="#10b981" strokeWidth="12" strokeLinecap="round"/>
      <line x1="346" y1="200" x2="396" y2="200" stroke="#10b981" strokeWidth="12" strokeLinecap="round"/>
    </svg>
  </div>;
}
