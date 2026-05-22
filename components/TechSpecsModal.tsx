'use client';

import { Product } from '@/lib/types';

interface Props {
  product: Product;
  onClose: () => void;
}

const techSpecsData: Record<string, Record<string, string>> = {
  'Edge': {
    'Processor / NPU': 'AMD Ryzen AI 9 HX 370 or equivalent',
    'Dedicated AI Acceleration': 'Up to 50 TOPS NPU',
    'System Memory': '24 GB LPDDR5X unified',
    'Storage': '1 TB PCIe 4.0 NVMe SSD',
    'Inference Performance': '60+ tokens/s (7B Q4)',
    'Max Model Size': '13B parameters (quantized)',
    'Networking': '2.5 GbE + Wi-Fi 6E',
    'Form Factor': 'Compact desktop (quiet, 35W TDP)',
    'Warranty': '3 years',
  },
  'Studio': {
    'GPU / Accelerator': 'NVIDIA RTX 4090 or dual RTX 3090 equivalent',
    'AI Performance': 'Up to 660 TOPS (Tensor)',
    'System Memory': '96 GB DDR5 ECC',
    'Storage': '4 TB NVMe RAID 1 (expandable)',
    'Inference Performance': 'High throughput multi-model',
    'Max Model Size': '70B parameters',
    'Networking': '10 GbE + dual 2.5 GbE',
    'Form Factor': 'Desktop tower (quiet optimized)',
    'Warranty': '3 years',
  },
  'Forge': {
    'Accelerators': '4× NVIDIA H100 / A100 or equivalent',
    'Total AI Performance': 'Up to 4000+ TFLOPS',
    'System Memory': '256–512 GB HBM3 / DDR5',
    'Storage': '8–16 TB Enterprise NVMe',
    'Inference Performance': 'Enterprise scale (multi-node ready)',
    'Max Model Size': '100B+ parameters + fine-tuning',
    'Networking': '100 GbE / InfiniBand ready',
    'Form Factor': '2U/4U Rackmount (cluster expandable)',
    'Warranty': '3 years + enterprise SLA options',
  },
};

export default function TechSpecsModal({ product, onClose }: Props) {
  const specs = techSpecsData[product.name] || {};

  return (
    <div className="fixed inset-0 bg-black/70 z-[120] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 max-w-2xl w-full rounded-3xl p-8" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between mb-6">
          <div>
            <div className="text-2xl font-semibold tracking-tight">{product.name} — Technical Specifications</div>
            <div className="text-cyan-400 text-sm">Full hardware & performance details</div>
          </div>
          <button onClick={onClose} className="text-2xl">×</button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 text-sm">
          {Object.entries(specs).map(([key, value]) => (
            <div key={key} className="flex justify-between py-2 border-b border-slate-800">
              <span className="text-slate-400">{key}</span>
              <span className="font-medium text-right">{value}</span>
            </div>
          ))}
        </div>

        <div className="mt-6 text-xs text-slate-500">All appliances come with 3-year warranty and EU-based support.</div>
      </div>
    </div>
  );
}
