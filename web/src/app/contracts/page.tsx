import type { Metadata } from "next";
import { PageHeader, DeploymentPending, NumSection } from "@/components/ui";
import { CONTRACTS, deployed, deployments, etherscanAddress, isZero } from "@/lib/deployments";

export const metadata: Metadata = { title: "Contracts" };

const poolPending = /^0x0{64}$/i.test(deployments.poolId);

function Verified() {
  return (
    <span className="verified">
      <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 5.2 L4 7.5 L8.5 2.5" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
      verified
    </span>
  );
}

export default function ContractsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Ethereum Sepolia · chain 11155111"
        title="Contracts"
        lede="Six contracts, one pool. Source is verified on Etherscan; what you read here is what runs."
      />
      {!deployed && <div className="mb-8"><DeploymentPending /></div>}

      <div className="sec-num mb-4"><b>01</b> / Addresses</div>
      <div className="card overflow-x-auto">
        <table className="feed" style={{ fontSize: "0.8125rem" }}>
          <thead>
            <tr>
              <th>Contract</th>
              <th>Address</th>
              <th className="text-right">Source</th>
            </tr>
          </thead>
          <tbody>
            {CONTRACTS.map((c) => {
              const addr = deployments[c.key] as string;
              const zero = isZero(addr);
              return (
                <tr key={c.key}>
                  <td className="whitespace-nowrap align-top">
                    <div className="font-sans text-sm text-paper">{c.name}</div>
                    <div className="mt-0.5 max-w-xs whitespace-normal font-sans text-xs leading-relaxed text-paper-3">{c.role}</div>
                  </td>
                  <td className="align-top">
                    {zero ? (
                      <span className="text-paper-3">not deployed</span>
                    ) : (
                      <a href={etherscanAddress(addr)} target="_blank" rel="noreferrer" className="text-brass underline underline-offset-4 hover:text-paper">{addr}</a>
                    )}
                  </td>
                  <td className="whitespace-nowrap text-right align-top">
                    {zero ? <span className="text-paper-3">pending</span> : <a href={`${etherscanAddress(addr)}#code`} target="_blank" rel="noreferrer"><Verified /></a>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="sec-num mb-4 mt-10"><b>02</b> / Pool and deployment</div>
      <div className="card divide-y divide-line">
        <Row label="Pool id" value={poolPending ? "pending" : deployments.poolId} />
        <Row label="Pool" value="native ETH / THALER · fee 1.00% · tick spacing 200 · Uniswap v4 · FlowHook attached" />
        <Row label="Pool manager" value={isZero(deployments.poolManager) ? "pending" : deployments.poolManager} href={isZero(deployments.poolManager) ? undefined : etherscanAddress(deployments.poolManager)} />
        <Row label="Deployer" value={isZero(deployments.deployer) ? "pending" : deployments.deployer} href={isZero(deployments.deployer) ? undefined : etherscanAddress(deployments.deployer)} />
        <Row label="Deployment block" value={deployments.block ? deployments.block.toLocaleString("en-US") : "pending"} />
        <Row label="Genesis" value={deployments.genesis ? new Date(deployments.genesis * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "pending"} />
        <Row label="Ownership" value="deployer, Ownable2Step, testnet only" />
      </div>

      <NumSection n="03" label="Verify it yourself" title="Do not take the badge on faith.">
        <div className="grid gap-px bg-line md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="min-w-0 bg-ink-2 p-5 sm:p-6">
            <p className="text-sm leading-relaxed text-paper-2">
              Clone the repository, build with Foundry, and compare the bytecode Etherscan holds against what the source compiles to. The command below submits the source for verification; if it is already verified it reports a match, and if the source differs it fails.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-paper-2">
              The interface ABIs this site is built against are the ones published in the repository. Wiring between contracts is set once after deployment and cannot be changed.
            </p>
          </div>
          <div className="min-w-0 bg-ink-2 p-5 sm:p-6">
            <div className="eyebrow mb-3">forge, from contracts/</div>
            <pre className="num overflow-x-auto text-xs leading-relaxed text-paper">{`forge verify-contract \\
  --chain sepolia \\
  --watch \\
  ${isZero(deployments.centralBank) ? "<address>" : deployments.centralBank} \\
  src/CentralBank.sol:CentralBank \\
  --etherscan-api-key $ETHERSCAN_API_KEY`}</pre>
            <p className="mt-3 text-xs leading-relaxed text-paper-3">Repeat per contract with its address and path. Constructor arguments are on the deployment transaction, or pass them with --constructor-args.</p>
          </div>
        </div>
      </NumSection>
    </>
  );
}

function Row({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
      <div className="shrink-0 text-sm text-paper-2">{label}</div>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="num break-all text-sm text-brass underline underline-offset-4 hover:text-paper">{value}</a>
      ) : (
        <div className="num break-all text-sm text-paper sm:text-right">{value}</div>
      )}
    </div>
  );
}
