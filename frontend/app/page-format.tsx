'use client';

import React, { useEffect, useRef } from 'react';
import Link from 'next/link';

export default function LandingPage() {
  const meshCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const networkCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // 1. Render 3D Surface Matrix Mesh Canvas
  useEffect(() => {
    const canvas = meshCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let time = 0;

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      time += 0.02;

      const rows = 16;
      const cols = 20;
      const width = canvas.width;
      const height = canvas.height;

      ctx.lineWidth = 1;

      for (let i = 0; i < rows; i++) {
        ctx.beginPath();
        for (let j = 0; j < cols; j++) {
          const x = (j / (cols - 1)) * (width - 40) + 20;
          const yBase = (i / (rows - 1)) * (height - 80) + 40;

          // Wave equation to create 3D surface grid
          const z =
            Math.sin(j * 0.4 + time) * 15 +
            Math.cos(i * 0.5 + time * 0.8) * 12 +
            Math.sin((i + j) * 0.3 + time) * 10;

          const y = yBase + z;

          if (j === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }

        const grad = ctx.createLinearGradient(0, 0, width, height);
        grad.addColorStop(0, 'rgba(129, 140, 248, 0.6)');
        grad.addColorStop(0.5, 'rgba(192, 132, 252, 0.8)');
        grad.addColorStop(1, 'rgba(244, 114, 182, 0.4)');

        ctx.strokeStyle = grad;
        ctx.stroke();
      }

      // Vertical grid lines
      for (let j = 0; j < cols; j += 2) {
        ctx.beginPath();
        for (let i = 0; i < rows; i++) {
          const x = (j / (cols - 1)) * (width - 40) + 20;
          const yBase = (i / (rows - 1)) * (height - 80) + 40;
          const z =
            Math.sin(j * 0.4 + time) * 15 +
            Math.cos(i * 0.5 + time * 0.8) * 12 +
            Math.sin((i + j) * 0.3 + time) * 10;

          const y = yBase + z;

          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.strokeStyle = 'rgba(192, 132, 252, 0.2)';
        ctx.stroke();
      }

      animId = requestAnimationFrame(render);
    };

    render();

    return () => cancelAnimationFrame(animId);
  }, []);

  // 2. Render 3D Network Constellation Sphere Canvas
  useEffect(() => {
    const canvas = networkCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let time = 0;

    const nodes = Array.from({ length: 18 }, () => ({
      x: (Math.random() - 0.5) * 120,
      y: (Math.random() - 0.5) * 120,
      z: (Math.random() - 0.5) * 120,
    }));

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      time += 0.015;

      const cx = canvas.width / 2;
      const cy = canvas.height / 2;

      const projected = nodes.map((node) => {
        const cos = Math.cos(time);
        const sin = Math.sin(time);

        const x = node.x * cos - node.z * sin;
        const z = node.z * cos + node.x * sin;
        const y = node.y;

        const scale = 180 / (180 + z);
        return {
          px: cx + x * scale,
          py: cy + y * scale,
          scale,
        };
      });

      // Connections
      for (let i = 0; i < projected.length; i++) {
        for (let j = i + 1; j < projected.length; j++) {
          const dx = projected[i].px - projected[j].px;
          const dy = projected[i].py - projected[j].py;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < 70) {
            ctx.beginPath();
            ctx.moveTo(projected[i].px, projected[i].py);
            ctx.lineTo(projected[j].px, projected[j].py);
            ctx.strokeStyle = `rgba(192, 132, 252, ${1 - dist / 70})`;
            ctx.lineWidth = 0.8;
            ctx.stroke();
          }
        }
      }

      // Nodes
      projected.forEach((p) => {
        ctx.beginPath();
        ctx.arc(p.px, p.py, 2.5 * p.scale, 0, Math.PI * 2);
        ctx.fillStyle = '#818cf8';
        ctx.fill();
      });

      animId = requestAnimationFrame(render);
    };

    render();

    return () => cancelAnimationFrame(animId);
  }, []);

  return (
    <div className="min-h-screen bg-[#07070d] text-slate-200 font-sans relative overflow-x-hidden flex flex-col justify-between selection:bg-purple-500/30">
      {/* Background Lighting Effects */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[400px] bg-gradient-to-b from-indigo-900/25 via-purple-900/15 to-transparent blur-[120px] pointer-events-none rounded-full" />
      <div className="absolute top-[25%] right-[-5%] w-[500px] h-[500px] bg-purple-600/10 blur-[150px] pointer-events-none rounded-full" />
      <div className="absolute top-[20%] left-[-5%] w-[450px] h-[450px] bg-indigo-600/10 blur-[150px] pointer-events-none rounded-full" />

      {/* Navigation Header */}
      <header className="border-b border-slate-800/60 bg-[#07070d]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-3.5 flex justify-between items-center">
          <div className="flex items-center gap-2.5">
            <div className="h-7 w-7 bg-indigo-600 rounded-md flex items-center justify-center font-black text-white text-xs shadow-md shadow-indigo-600/30">
              M
            </div>
            <span className="font-bold text-base tracking-tight text-white">
              MacroRisk <span className="text-indigo-400 font-normal">Middleware</span>
            </span>
          </div>

          <nav className="hidden md:flex gap-8 text-xs font-medium text-slate-300">
            <a href="#features" className="hover:text-white transition-colors">Features</a>
            <a href="#pricing" className="hover:text-white transition-colors">Pricing</a>
            <a href="#docs" className="hover:text-white transition-colors">Docs</a>
          </nav>

          <div>
            <Link
              href="/dashboard"
              className="px-4 py-1.5 text-xs font-semibold bg-slate-100 hover:bg-white text-slate-950 rounded-lg transition-all shadow-sm"
            >
              Launch App
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="max-w-6xl mx-auto px-6 pt-12 pb-12 relative z-10 w-full">
        <div className="grid md:grid-cols-12 gap-8 items-center">
          
          {/* Left Text */}
          <div className="md:col-span-7 text-left">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900/90 border border-slate-800 text-indigo-300 text-[11px] font-medium mb-5 backdrop-blur-sm">
              <span className="bg-indigo-500/20 text-indigo-400 px-1.5 py-0.5 rounded text-[9px] font-bold">
                NEW
              </span>
              1870s Stagflation & Rate Spike Simulation Engine
            </div>

            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-white tracking-tight leading-[1.15]">
              Institutional Macro Stress-Testing <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-300 via-purple-300 to-pink-300">
                Without the Bloomberg Price Tag
              </span>
            </h1>

            <p className="mt-4 text-xs sm:text-sm text-slate-400 max-w-xl leading-relaxed">
              Based on provided and Stress-Testing Without the Bloomberg Price Tag. Translate complex yield curves, central bank liquidity squeezes, and stagflation regimes into clear, client-ready risk reports for RIAs and family offices.
            </p>

            <div className="mt-7 flex items-center gap-3">
              <Link
                href="/dashboard"
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg shadow-lg shadow-indigo-600/30 transition-all"
              >
                Start Free 14-Day Trial
              </Link>
              <a
                href="#pricing"
                className="px-5 py-2.5 bg-slate-900/90 border border-slate-800 hover:bg-slate-800 text-slate-300 text-xs font-semibold rounded-lg transition-all"
              >
                View Pricing
              </a>
            </div>
          </div>

          {/* Right 3D Surface Matrix Mesh */}
          <div className="md:col-span-5 relative flex justify-center items-center">
            <div className="relative w-full max-w-[320px] aspect-square flex items-center justify-center">
              <div className="absolute inset-0 bg-gradient-to-tr from-purple-600/25 via-pink-500/15 to-transparent blur-3xl rounded-full" />
              <canvas
                ref={meshCanvasRef}
                width={320}
                height={320}
                className="relative z-10 w-full h-full"
              />
              <div className="absolute top-2 right-0 bg-slate-900/90 border border-purple-500/30 text-[10px] text-slate-300 px-3 py-1.5 rounded-lg shadow-xl backdrop-blur-md">
                <div className="text-purple-300 font-semibold">Correlated Matrix Risk</div>
                <div className="text-[8px] text-slate-500">Constrained Heteroskedasticity</div>
              </div>
            </div>
          </div>

        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="max-w-5xl mx-auto px-6 py-10 relative z-10 w-full">
        <div className="text-center mb-8">
          <h2 className="text-xl font-bold text-white tracking-tight">Features</h2>
        </div>

        <div className="grid md:grid-cols-3 gap-5">
          {/* Feature 1 */}
          <div className="bg-[#0f0e1a]/60 backdrop-blur-md p-5 rounded-xl border border-slate-800/80 hover:border-indigo-500/30 transition-all">
            <div className="h-8 w-8 bg-indigo-500/10 rounded-lg border border-indigo-500/20 flex items-center justify-center text-indigo-400 mb-3 text-sm">
              📊
            </div>
            <h3 className="text-sm font-bold text-white mb-1">Monte Carlo Engine</h3>
            <p className="text-slate-400 text-xs leading-relaxed">
              Monte Carlo Engine ingestion. Monte Carlo Engine simulation models portfolio VaR & Expected Shortfall.
            </p>
          </div>

          {/* Feature 2 */}
          <div className="bg-[#0f0e1a]/60 backdrop-blur-md p-5 rounded-xl border border-slate-800/80 hover:border-purple-500/30 transition-all">
            <div className="h-8 w-8 bg-purple-500/10 rounded-lg border border-purple-500/20 flex items-center justify-center text-purple-400 mb-3 text-sm">
              ⚡
            </div>
            <h3 className="text-sm font-bold text-white mb-1">Live Macro Data</h3>
            <p className="text-slate-400 text-xs leading-relaxed">
              Live Macro Data platform with Live FRED APIs & balance sheet analysis for live yield dynamics.
            </p>
          </div>

          {/* Feature 3 */}
          <div className="bg-[#0f0e1a]/60 backdrop-blur-md p-5 rounded-xl border border-slate-800/80 hover:border-pink-500/30 transition-all">
            <div className="h-8 w-8 bg-pink-500/10 rounded-lg border border-pink-500/20 flex items-center justify-center text-pink-400 mb-3 text-sm">
              📄
            </div>
            <h3 className="text-sm font-bold text-white mb-1">Client-Ready Narratives</h3>
            <p className="text-slate-400 text-xs leading-relaxed">
              Polished multi-client connections & Polished market narratives delivered in executive PDF format.
            </p>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="max-w-5xl mx-auto px-6 py-10 relative z-10 w-full">
        <div className="text-center mb-8">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Pricing</h2>
          <p className="text-xl font-extrabold text-white mt-1">Transparent, Firm-Wide Pricing</p>
        </div>

        <div className="relative max-w-2xl mx-auto grid grid-cols-1 sm:grid-cols-2 gap-5 items-center">
          {/* Standard Plan */}
          <div className="bg-[#0f0e1a]/70 backdrop-blur-md p-6 rounded-xl border border-slate-800 flex justify-between items-center">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-sm font-bold text-white">RIA Standard</h3>
                <span className="text-emerald-400 text-xs">✓</span>
              </div>
              <div className="text-2xl font-extrabold text-white">$199</div>
            </div>
          </div>

          {/* Pro Plan */}
          <div className="bg-gradient-to-br from-purple-950/50 via-[#0f0e1a]/80 to-[#0f0e1a] backdrop-blur-md p-6 rounded-xl border border-purple-500/50 flex justify-between items-center relative shadow-xl shadow-purple-950/40">
            <div className="absolute -top-2.5 right-4 bg-purple-500 text-white text-[9px] font-extrabold px-2.5 py-0.5 rounded-full uppercase tracking-wider">
              POPULAR
            </div>
            <div>
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-sm font-bold text-white">Family Office Pro</h3>
                <span className="text-emerald-400 text-xs">✓</span>
              </div>
              <div className="text-2xl font-extrabold text-white">$499</div>
            </div>
          </div>

          {/* 3D Network Constellation Orb on Right */}
          <div className="hidden lg:block absolute -right-32 top-1/2 -translate-y-1/2 w-28 h-28 pointer-events-none opacity-80">
            <canvas ref={networkCanvasRef} width={112} height={112} />
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-[#050508] py-4 text-center text-[11px] text-slate-600 relative z-10">
        <p>© Copyright | Next.js / React landing page code</p>
      </footer>
    </div>
  );
}