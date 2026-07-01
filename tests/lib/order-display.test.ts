import { describe, it, expect } from 'vitest'
import { buildOrderDisplayFromMetadata } from '@/lib/order-display'

describe('lib/order-display', () => {
  it('hardwareStr includes serial numbers from metadata', () => {
    const hardware = JSON.stringify([
      { name: 'Edge', config: '2 TB RAM', serialNumber: 'NC-EDGE-ABC123' },
      { name: 'Studio', config: 'Standard', serialNumber: 'NC-STUDIO-DEF456' },
    ])
    const { hardwareStr } = buildOrderDisplayFromMetadata({ hardware, services: '[]' })
    expect(hardwareStr).toContain('Edge (S/N NC-EDGE-ABC123, 2 TB RAM)')
    expect(hardwareStr).toContain('Studio (S/N NC-STUDIO-DEF456)')
  })

  it('servicesStr includes host appliance S/N', () => {
    const services = JSON.stringify([
      { n: 'Managed Care', p: 99, sn: 'NC-STUDIO-ABC', hs: 'studio', hn: 'Studio' },
    ])
    const { servicesStr } = buildOrderDisplayFromMetadata(
      { services, pricing_version: 'test-v' },
      'test-v',
    )
    expect(servicesStr).toContain('appliance S/N NC-STUDIO-ABC')
  })
})