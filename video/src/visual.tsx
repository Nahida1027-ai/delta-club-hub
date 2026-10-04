import React from 'react';
import {AbsoluteFill, Easing, Img, interpolate, staticFile} from 'remotion';

export const C = {
  bg: '#090A0D',
  panel: '#17191E',
  panel2: '#20242C',
  white: '#F5F7FA',
  mute: '#88919E',
  blue: '#007AFF',
  cyan: '#64D2FF',
  green: '#30D158',
  orange: '#FF9F0A',
  line: 'rgba(255,255,255,.13)',
};
export const FONT = 'Microsoft YaHei, PingFang SC, Segoe UI, sans-serif';
export const easeFast = Easing.bezier(0.22, 1, 0.36, 1);
export const easeCamera = Easing.bezier(0.65, 0, 0.18, 1);
export const easePrecise = Easing.bezier(0.24, 0.8, 0.28, 1);

export function anim(f: number, start: number, duration: number, from = 0, to = 1, easing = easeFast) {
  return interpolate(f, [start, start + duration], [from, to], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing,
  });
}

export function money(value: number, decimals = 0) {
  return `¥${value.toLocaleString('zh-CN', {minimumFractionDigits: decimals, maximumFractionDigits: decimals})}`;
}

export const Backplane: React.FC<{frame: number; glow?: string}> = ({frame, glow = C.blue}) => (
  <AbsoluteFill style={{
    background: `radial-gradient(ellipse 860px 620px at ${50 + Math.sin(frame / 280) * 4}% ${43 + Math.cos(frame / 340) * 3}%, ${glow}13, transparent 72%), #090A0D`,
    overflow: 'hidden',
  }}>
    <div style={{
      position: 'absolute', inset: -140,
      backgroundImage: 'linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px)',
      backgroundSize: '94px 94px',
      transform: `translate(${Math.sin(frame / 110) * 18}px, ${Math.cos(frame / 160) * 12}px) rotateX(12deg)`,
      maskImage: 'radial-gradient(ellipse 80% 70% at 50% 50%, black, transparent)',
      opacity: 0.55,
    }} />
  </AbsoluteFill>
);

export const Kicker: React.FC<{children: React.ReactNode; x?: number; y?: number; color?: string; size?: number}> = ({children, x = 110, y = 100, color = C.cyan, size = 24}) => (
  <div style={{position: 'absolute', left: x, top: y, color, fontSize: size, fontWeight: 700, letterSpacing: 4}}>{children}</div>
);

export const Headline: React.FC<{children: React.ReactNode; x?: number; y?: number; size?: number; width?: number; color?: string}> = ({children, x = 108, y = 160, size = 77, width = 1300, color = C.white}) => (
  <div style={{position: 'absolute', left: x, top: y, width, color, fontSize: size, fontWeight: 750, letterSpacing: -3, lineHeight: 1.2}}>{children}</div>
);

export const PhotoPlane: React.FC<{
  file: string;
  left: number;
  top: number;
  width: number;
  height: number;
  scale?: number;
  opacity?: number;
  rotate?: number;
  imageScale?: number;
  imageX?: number;
  imageY?: number;
  borderRadius?: number;
}> = ({file, left, top, width, height, scale = 1, opacity = 1, rotate = 0, imageScale = 1, imageX = 0, imageY = 0, borderRadius = 24}) => (
  <div style={{
    position: 'absolute', left, top, width, height, opacity,
    borderRadius, overflow: 'hidden',
    border: '1px solid rgba(255,255,255,.16)',
    background: C.panel,
    boxShadow: '0 48px 110px rgba(0,0,0,.58), 0 0 46px rgba(0,122,255,.07)',
    transform: `scale(${scale}) rotate(${rotate}deg)`,
    transformOrigin: 'center center',
  }}>
    <Img src={staticFile(`captures/${file}`)} style={{
      width: 1920, height: 1080, maxWidth: 'none',
      position: 'absolute', left: imageX, top: imageY,
      transform: `scale(${imageScale})`, transformOrigin: 'top left',
    }} />
  </div>
);

export const GlassCard: React.FC<{
  children: React.ReactNode;
  style?: React.CSSProperties;
  tone?: string;
}> = ({children, style, tone = C.blue}) => (
  <div style={{
    borderRadius: 28,
    border: '1px solid rgba(255,255,255,.15)',
    background: 'linear-gradient(145deg, rgba(33,37,46,.93), rgba(16,18,23,.92))',
    boxShadow: `0 32px 86px rgba(0,0,0,.4), 0 0 36px ${tone}12`,
    backdropFilter: 'blur(20px)',
    ...style,
  }}>{children}</div>
);

export const Dot: React.FC<{x: number; y: number; r?: number; color?: string; pulse?: number}> = ({x,y,r=7,color=C.blue,pulse=0}) => (
  <>
    <circle cx={x} cy={y} r={r + pulse * 8} fill={color} opacity={0.13 * (1 - pulse * 0.6)} />
    <circle cx={x} cy={y} r={r} fill={color} />
  </>
);
