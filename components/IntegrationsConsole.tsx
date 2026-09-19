"use client";

import { useState } from "react";
import clsx from "clsx";
import { ArrowRight, Cpu, Radio, Wifi, WifiOff } from "lucide-react";
import { Pill } from "@/components/ui";

export interface AdapterView {
  vendor: string;
  label: string;
  integration: string;
  docsUrl: string;
  connectedDevices: number;
  sampleRaw: Record<string, unknown>;
  sampleNormalised: Record<string, unknown> | null;
  error: string | null;
}

export interface ConnectedDevice {
  id: string;
  vendor: string;
  imei: string;
  vehicleId: string;
  online: boolean;
  lastSeenAt: string;
  firmware: string;
}

export default function IntegrationsConsole({
  adapters,
  connected,
}: {
  adapters: AdapterView[];
  connected: ConnectedDevice[];
}) {
  const [selected, setSelected] = useState(adapters[0]?.vendor ?? "");
  const active = adapters.find((a) => a.vendor === selected) ?? adapters[0];
  const devices = connected.filter((d) => d.vendor === selected);

  return (
    <div className="grid gap-4 xl:grid-cols-[300px_1fr]">
      <div className="vf-panel overflow-hidden">
        <header className="border-b border-line px-4 py-3">
          <h2 className="text-[12.5px] font-semibold text-ink">Supported trackers</h2>
          <p className="mt-0.5 text-[10.5px] text-muted">
            {adapters.length} adapters. Add a brand by adding one file.
          </p>
        </header>
        <ul>
          {adapters.map((adapter) => {
            const isActive = adapter.vendor === selected;
            return (
              <li key={adapter.vendor}>
                <button
                  onClick={() => setSelected(adapter.vendor)}
                  className={clsx(
                    "flex w-full items-start gap-3 border-b border-line/60 px-4 py-3 text-left transition-colors last:border-0",
                    isActive ? "bg-signal/10" : "hover:bg-surface-2/60",
                  )}
                >
                  <Radio
                    className={clsx("mt-0.5 h-4 w-4 shrink-0", isActive ? "text-signal" : "text-faint")}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12px] font-medium text-ink">{adapter.label}</span>
                    <span className="block font-mono text-[10px] text-faint">{adapter.vendor}</span>
                  </span>
                  <span className="vf-num shrink-0 text-[10.5px] text-muted">
                    {adapter.connectedDevices}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {active && (
        <div className="flex flex-col gap-4">
          <div className="vf-panel p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-semibold text-ink">{active.label}</h2>
                <p className="mt-1 max-w-xl text-[11.5px] leading-relaxed text-muted">
                  {active.integration}
                </p>
              </div>
              <Pill tone={active.connectedDevices > 0 ? "mint" : "muted"} dot>
                {active.connectedDevices} device{active.connectedDevices === 1 ? "" : "s"} connected
              </Pill>
            </div>

            {active.docsUrl && (
              <a
                href={active.docsUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-medium text-signal hover:text-ink"
              >
                Vendor documentation <ArrowRight className="h-3.5 w-3.5" />
              </a>
            )}
          </div>

          <div className="vf-panel overflow-hidden">
            <header className="border-b border-line px-5 py-3">
              <h3 className="text-[12.5px] font-semibold text-ink">Live normalisation preview</h3>
              <p className="mt-0.5 text-[10.5px] text-muted">
                Exactly what the adapter does to this vendor&apos;s payload, executed on the server.
              </p>
            </header>
            <div className="grid gap-4 p-5 lg:grid-cols-[1fr_auto_1fr]">
              <div className="min-w-0">
                <div className="mb-2 flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-faint">
                  <Cpu className="h-3.5 w-3.5" /> Vendor payload
                </div>
                <pre className="max-h-[280px] overflow-auto rounded-xl border border-line bg-void/70 p-3 font-mono text-[10.5px] leading-relaxed text-muted">
                  {JSON.stringify(active.sampleRaw, null, 2)}
                </pre>
              </div>

              <div className="hidden items-center justify-center lg:flex">
                <span className="grid h-9 w-9 place-items-center rounded-full border border-signal/30 bg-signal/10">
                  <ArrowRight className="h-4 w-4 text-signal" />
                </span>
              </div>

              <div className="min-w-0">
                <div className="mb-2 flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-faint">
                  <Radio className="h-3.5 w-3.5" /> Canonical TelemetryPing
                </div>
                <pre className="max-h-[280px] overflow-auto rounded-xl border border-mint/20 bg-void/70 p-3 font-mono text-[10.5px] leading-relaxed text-mint/90">
                  {active.error
                    ? `error: ${active.error}`
                    : JSON.stringify(active.sampleNormalised, null, 2)}
                </pre>
              </div>
            </div>
          </div>

          <div className="vf-panel overflow-hidden">
            <header className="border-b border-line px-5 py-3">
              <h3 className="text-[12.5px] font-semibold text-ink">
                Devices on this adapter — {devices.length}
              </h3>
            </header>
            {devices.length === 0 ? (
              <div className="px-5 py-6 text-center text-[11.5px] text-muted">
                No vehicles currently reporting through this vendor.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-left text-[12px]">
                  <thead>
                    <tr className="border-b border-line text-[10px] uppercase tracking-[0.12em] text-faint">
                      <th className="px-5 py-2.5 font-semibold">Device</th>
                      <th className="px-5 py-2.5 font-semibold">IMEI</th>
                      <th className="px-5 py-2.5 font-semibold">Firmware</th>
                      <th className="px-5 py-2.5 font-semibold">State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {devices.map((device) => (
                      <tr key={device.id} className="border-b border-line/60 last:border-0">
                        <td className="px-5 py-2.5 font-mono text-[11px] text-ink">{device.id}</td>
                        <td className="vf-num px-5 py-2.5 text-[11px] text-muted">{device.imei}</td>
                        <td className="px-5 py-2.5 font-mono text-[11px] text-muted">{device.firmware}</td>
                        <td className="px-5 py-2.5">
                          <span className="inline-flex items-center gap-1.5 text-[11px]">
                            {device.online ? (
                              <>
                                <Wifi className="h-3.5 w-3.5 text-mint" />
                                <span className="text-mint">online</span>
                              </>
                            ) : (
                              <>
                                <WifiOff className="h-3.5 w-3.5 text-faint" />
                                <span className="text-faint">offline</span>
                              </>
                            )}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
