// Mini launchpad on GIWA Sepolia using @ammora-protocol/sdk@0.2.13 (permissionless V4) + viem.
// No manifest file needed: uses the SDK's built-in giwaSepoliaPermissionless deployment.
import { useEffect, useState } from "react";
import { createPublicClient, createWalletClient, custom, defineChain, http } from "viem";
import {
  buildCreateAmmoraV4Launch,
  getAmmoraV4ConfigAtBlock,
  getAmmoraV4NextConfigId,
  giwaSepoliaPermissionless,
  parseAmmoraV4LaunchCreatedReceipt,
} from "@ammora-protocol/sdk";


const dep = giwaSepoliaPermissionless;
const FACTORY = dep.contracts.launch.factory as `0x${string}`;
const REGISTRY = dep.contracts.launch.configRegistry as `0x${string}`;
const CHAIN_ID = BigInt(dep.chain.id);
const DATA_API = `${window.location.origin}/ammora-api`;

const giwa = defineChain({
  id: dep.chain.id,
  name: dep.chain.name,
  nativeCurrency: dep.chain.nativeCurrency,
  rpcUrls: { default: { http: [...dep.chain.rpcUrls] } },
  blockExplorers: { default: { name: "GIWA Explorer", url: dep.chain.blockExplorerUrl } },
});


const publicClient = createPublicClient({ chain: giwa, transport: http() });
const show = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x), 2);

export default function App() {
  const [account, setAccount] = useState<`0x${string}` | null>(null);
  const [launches, setLaunches] = useState<any[]>([]);
  const [configId, setConfigId] = useState<string>("");
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [fee, setFee] = useState("0"); // pool creation fee in wei; raise if the simulation says so
  const [status, setStatus] = useState("");

  function getJson(path: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("GET", `${DATA_API}${path}`);
    x.onload = () => {
      if (x.status >= 200 && x.status < 300) {
        try { resolve(JSON.parse(x.responseText)); } catch (e) { reject(e); }
      } else reject(new Error(`${x.status} ${x.statusText}`));
    };
    x.onerror = () => reject(new Error("Network error"));
    x.send();
  });
}

async function refresh() {
  try {
    const res: any = await getJson(`/v1/tokens?chainId=${CHAIN_ID}`);
    setLaunches(Array.isArray(res) ? res : res?.items ?? res?.data ?? []);
  } catch (e: any) {
    setStatus(`Could not load launches: ${e.message}`);
  }
}

async function loadConfig() {
  try {
    const pc = publicClient as any;
    const block = await pc.getBlockNumber();
    const next = await getAmmoraV4NextConfigId(pc, REGISTRY, block);
    for (let id = next - 1n; id >= 0n && id > next - 40n; id--) {
      try {
        const snap = await getAmmoraV4ConfigAtBlock(pc, REGISTRY, id, block);
        if (snap.enabled) { setConfigId(String(id)); return; }
      } catch {}
    }
    setStatus("No enabled launch config found.");
  } catch (e: any) {
    setStatus(`Could not read configs: ${e.message}`);
  }
}

  useEffect(() => { refresh(); loadConfig(); }, []);

  async function connect() {
    const eth = (window as any).ethereum;
    if (!eth) return setStatus("No wallet found. Install MetaMask or Rabby.");
    const [addr] = await eth.request({ method: "eth_requestAccounts" });
    const wallet = createWalletClient({ chain: giwa, transport: custom(eth) });
    try { await wallet.switchChain({ id: giwa.id }); }
    catch { await wallet.addChain({ chain: giwa }); }
    setAccount(addr);
  }

  async function createLaunch(e: React.FormEvent) {
    e.preventDefault();
    if (!account) return setStatus("Connect your wallet first.");
    if (!configId) return setStatus("No launch config loaded yet.");
    try {
      const tx = buildCreateAmmoraV4Launch(
        { name, symbol, metadataURI: "ipfs://token-metadata", creatorMetadataURI: "ipfs://creator-metadata", tokenDecimals: 9 },
        BigInt(configId),
        BigInt(fee),
      );
      setStatus("Simulating…");
      await publicClient.call({ account, to: FACTORY, data: tx.data, value: tx.value });

      const wallet = createWalletClient({ chain: giwa, transport: custom((window as any).ethereum) });
      setStatus("Confirm in your wallet…");
      const hash = await wallet.sendTransaction({ account, to: FACTORY, data: tx.data, value: tx.value });
      setStatus(`Sent ${hash}, waiting…`);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      let info = "";
      try { info = show(parseAmmoraV4LaunchCreatedReceipt(receipt, FACTORY)); } catch {}
      setStatus(`Launched ${symbol}. Tx ${hash}\n${info}`);
      refresh();
    } catch (err: any) {
      setStatus(`Failed: ${err.shortMessage ?? err.message}`);
    }
  }

  return (
    <main style={{ maxWidth: 640, margin: "40px auto", fontFamily: "system-ui", padding: 16 }}>
      <h1>Launchpad on Ammora</h1>
      <p>Create a token on GIWA Sepolia testnet and browse recent launches.</p>
      <button onClick={connect}>{account ? `${account.slice(0, 6)}…${account.slice(-4)}` : "Connect wallet"}</button>

      <form onSubmit={createLaunch} style={{ display: "grid", gap: 8, margin: "24px 0" }}>
        <input placeholder="Token name" value={name} onChange={(e) => setName(e.target.value)} required />
        <input placeholder="Symbol" value={symbol} onChange={(e) => setSymbol(e.target.value)} required />
        <input placeholder="Pool creation fee (wei)" value={fee} onChange={(e) => setFee(e.target.value)} />
        <small>Launch config: {configId || "loading…"}</small>
        <button type="submit">Create launch</button>
      </form>
      <pre role="status" style={{ whiteSpace: "pre-wrap" }}>{status}</pre>

      <h2>Recent launches</h2>
      {launches.length === 0 && <p>No launches loaded yet.</p>}
      <ul>
        {launches.map((l, i) => (
          <li key={l.token ?? l.tokenAddress ?? i}>
            {l.symbol ?? "?"} {l.name ? `· ${l.name}` : ""} {l.token ?? l.tokenAddress ?? ""}
          </li>
        ))}
      </ul>
    </main>
  );
}