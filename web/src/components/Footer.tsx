import Link from "next/link";
import { deployed, deployments, etherscanAddress } from "@/lib/deployments";

export function Footer() {
  return (
    <footer className="hairline-t mt-24">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 text-sm text-paper-3 sm:flex-row sm:items-start sm:justify-between sm:px-6">
        <div>
          <div className="font-display text-base tracking-[0.22em] text-paper-2">THALER</div>
          <p className="mt-2 max-w-xs leading-relaxed">Testnet. No value.</p>
          <p className="mt-1 max-w-xs leading-relaxed">A currency with a central bank written in code. Ethereum Sepolia.</p>
        </div>
        <ul className="flex flex-wrap gap-x-6 gap-y-2">
          <li><Link href="/whitepaper/" className="hover:text-paper">Whitepaper</Link></li>
          <li><Link href="/contracts/" className="hover:text-paper">Contracts</Link></li>
          <li><Link href="/updates/" className="hover:text-paper">Updates</Link></li>
          {deployed && (
            <li><a href={etherscanAddress(deployments.token)} target="_blank" rel="noreferrer" className="hover:text-paper">Etherscan</a></li>
          )}
          <li><a href="https://sepoliafaucet.com" target="_blank" rel="noreferrer" className="hover:text-paper">Sepolia faucet</a></li>
        </ul>
      </div>
    </footer>
  );
}
