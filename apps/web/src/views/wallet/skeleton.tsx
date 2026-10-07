import { PencilIcon, PlusIcon, TrashIcon } from "../../icons.tsx";
import { useSettings } from "../../lib/settings.tsx";
import { topUpMonthCount } from "@headroom/view-model/wallet";
import { currencyName, currencySymbol } from "@headroom/view-model/wallet-money";
import { Button } from "../../ui/button.tsx";
import { Select } from "../../ui/select.tsx";
import { cssVars } from "../../ui/css-vars.ts";
import { LoadingNote, Sk } from "../../ui/skeleton.tsx";
// The skeleton is the Suspense fallback while this view's code loads, so its styles ship with the first screen.
import "../../ui/spark-bars.css";
import "./wallet.css";
import "./spend.css";

const statLabels = ["Subscriptions", "Usage Spend", "Top-Ups This Month", "All-In This Month"];
const kinds = ["plan", "usage", "topup"] as const;
const keyNames = ["Plan", "Usage", "Top-ups"] as const;
const barHeights = [38, 62, 24, 80, 52, 100];
const mixWidths = ["92%", "64%", "46%", "30%", "18%"];

/** The static controls beside the title: the real picker and button, inert. */
function Tools() {
  // The saved display currency, once settings are in, so the picker does not change when the Wallet loads.
  const currency = useSettings().settings.walletCurrency ?? "USD";
  return (
    <div className="w-tools">
      <h1 className="w-title">Wallet</h1>
      <div className="w-segs" inert aria-hidden="true">
        <Select
          label="Currency"
          hideLabel
          size="sm"
          value={currency}
          options={[
            {
              value: currency,
              label: currency,
              meta: `${currencySymbol(currency)} · ${currencyName(currency)}`,
            },
          ]}
          onChange={() => undefined}
        />
        <Button variant="primary" size="sm" icon={<PlusIcon />} tabIndex={-1}>
          Add Top-Up
        </Button>
      </div>
    </div>
  );
}

function Band() {
  return (
    <dl className="w-band" aria-hidden="true">
      {statLabels.map((label) => (
        <div key={label} className="w-stat">
          <dt>
            <span>{label}</span>
          </dt>
          <dd className="w-num">
            <Sk kind="text" width={92} />
          </dd>
          <dd className="w-cap">
            <span>
              <Sk kind="text" width={110} />
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function KeyList() {
  return (
    <>
      {kinds.map((kind, index) => (
        <span key={kind} className="sp-key">
          <i data-kind={kind} />
          {keyNames[index]}
        </span>
      ))}
    </>
  );
}

function SpendRow(props: { readonly width: string }) {
  return (
    <tr>
      <th scope="row">
        <span className="sp-who">
          <Sk width={8} height={8} className="w-sk-round" />
          <Sk width={20} height={20} className="w-sk-round" />
          <span>
            <Sk kind="text" width={72} />
          </span>
        </span>
      </th>
      <td className="sp-mix">
        <Sk kind="bar" height={8} width={props.width} />
      </td>
      {[0, 1, 2].map((index) => (
        <td key={index} className="num">
          <Sk kind="text" width={44} />
        </td>
      ))}
      <td className="num sp-total">
        <Sk kind="text" width={52} />
      </td>
      <td className="num sp-share">
        <Sk kind="text" width={28} />
      </td>
    </tr>
  );
}

function SpendCard() {
  return (
    <section className="w-spend" aria-hidden="true">
      <div className="w-card">
        <header className="w-card-head">
          <h2>Spend by Provider</h2>
          <span className="muted">This month · all-in</span>
        </header>
        <div className="sp-body">
          <div className="sp-chart">
            <Sk kind="ring" width="100%" className="w-sk-ring" />
            <div className="sp-center">
              <span className="sp-center-label">All-in this month</span>
              <span className="sp-center-value num">
                <Sk kind="text" width={88} />
              </span>
              <span className="sp-center-meta">
                <Sk kind="text" width={90} />
              </span>
            </div>
          </div>
          <p className="sp-legend">
            <KeyList />
          </p>
          <table className="sp-table">
            <thead>
              <tr>
                <th scope="col">Provider</th>
                <th scope="col" className="sp-mix-head">
                  <span className="sp-keys">
                    <KeyList />
                  </span>
                </th>
                <th scope="col" className="sp-n">
                  Plan
                </th>
                <th scope="col" className="sp-n">
                  Usage
                </th>
                <th scope="col" className="sp-n">
                  Top-ups
                </th>
                <th scope="col">Total</th>
                <th scope="col">Share</th>
              </tr>
            </thead>
            <tbody>
              {mixWidths.map((width) => (
                <SpendRow key={width} width={width} />
              ))}
            </tbody>
          </table>
        </div>
        <p className="w-card-foot muted">
          <Sk kind="text" width={220} />
        </p>
      </div>
    </section>
  );
}

function TopUpsGlance() {
  return (
    <section className="w-glance-card">
      <div className="w-card">
        <header className="w-card-head">
          <h2>Top-Ups</h2>
          <span className="muted">Last {topUpMonthCount} months</span>
        </header>
        <div className="w-card-body">
          <figure className="spark" style={cssVars({ "--plot": "120px" })}>
            <div className="spark-readout" />
            <div className="spark-plot">
              {barHeights.map((height) => (
                <span key={height} className="spark-slot">
                  <span className="spark-well">
                    <Sk kind="block" height={`${height}%`} className="w-sk-bar" />
                  </span>
                  <span className="spark-tick">
                    <Sk kind="text" width={22} />
                  </span>
                </span>
              ))}
            </div>
          </figure>
        </div>
        <div className="w-card-foot muted">
          <Sk kind="text" width={90} />
        </div>
      </div>
    </section>
  );
}

function RenewalsGlance() {
  return (
    <section className="w-glance-card">
      <div className="w-card">
        <header className="w-card-head">
          <h2>Upcoming Renewals</h2>
          <span className="muted">
            <Sk kind="text" width={96} />
          </span>
        </header>
        <div className="w-card-body">
          <ul className="w-renewals">
            {[0, 1, 2, 3].map((index) => (
              <li key={index}>
                <Sk width={36} height={36} className="sk-tile" />
                <Sk width={20} height={20} className="w-sk-round" />
                <span className="w-renewal-text">
                  <span className="w-renewal-name">
                    <Sk kind="text" width={110} />
                  </span>
                  <span className="w-renewal-when">
                    <Sk kind="text" width={64} />
                  </span>
                </span>
                <span className="w-renewal-amount num">
                  <Sk kind="text" width={44} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/** The row buttons keep their real look and cannot be pressed. */
function RowActions(props: { readonly remove?: boolean }) {
  return (
    <div className="w-act" inert>
      <Button variant="quiet" size="sm" tabIndex={-1}>
        <PencilIcon />
      </Button>
      <Button variant="quiet" size="sm" tabIndex={-1}>
        {props.remove === true ? <TrashIcon /> : <PlusIcon />}
      </Button>
    </div>
  );
}

function GroupRow() {
  return (
    <li className="w-group">
      <Sk width={20} height={20} className="w-sk-round" />
      <h3>
        <Sk kind="text" width={80} />
      </h3>
      <span className="w-subtotal">
        <Sk kind="text" width={96} />
      </span>
    </li>
  );
}

function AccountRow(props: { readonly usedLabel: string }) {
  return (
    <li className="w-row">
      <div className="w-who">
        <span className="w-name">
          <Sk kind="text" width={150} />
        </span>
        <span className="w-sub">
          <Sk kind="text" width={170} />
        </span>
      </div>
      <div className="w-col w-c-cost" data-label="Cost / Month">
        <span className="w-cost">
          <span className="w-figure num">
            <Sk kind="text" width={64} />
          </span>
          <span className="muted num">
            <Sk kind="text" width={80} />
          </span>
        </span>
      </div>
      <div className="w-col w-c-used" data-label={props.usedLabel}>
        <span className="d-limit">
          <span className="d-limit-top">
            <b>
              <Sk kind="text" width={36} />
            </b>
            <span className="window">
              <Sk kind="text" width={64} />
            </span>
          </span>
          <Sk kind="bar" height={6} className="w-sk-track" />
        </span>
      </div>
      <div className="w-col w-c-renew" data-label="Renews">
        <span>
          <Sk kind="text" width={52} />
        </span>
      </div>
      <div className="w-col w-c-spend" data-label="Usage Spend">
        <span className="w-cost">
          <span className="w-figure num">
            <Sk kind="text" width={52} />
          </span>
        </span>
      </div>
      <div className="w-col w-c-credits" data-label="Credits">
        <span className="w-cost">
          <span className="w-figure num">
            <Sk kind="text" width={60} />
          </span>
        </span>
      </div>
      <RowActions />
    </li>
  );
}

function AccountsCard() {
  const usedLabel = useSettings().settings.limitsView === "left" ? "Left" : "Used";
  return (
    <section className="provider w-accounts" aria-hidden="true">
      <header>
        <h2>Accounts</h2>
      </header>
      <div className="w-card">
        <div className="w-colhead">
          <span>Account</span>
          <span>Cost / Month</span>
          <span>{usedLabel}</span>
          <span>Renews</span>
          <span>Usage Spend</span>
          <span>Credits</span>
          <span />
        </div>
        <ul className="w-rows">
          <GroupRow />
          <AccountRow usedLabel={usedLabel} />
          <AccountRow usedLabel={usedLabel} />
          <GroupRow />
          <AccountRow usedLabel={usedLabel} />
        </ul>
      </div>
    </section>
  );
}

function TopUpRow() {
  return (
    <li className="w-row w-topup">
      <span className="w-date num">
        <Sk kind="text" width={52} />
      </span>
      <span className="w-account">
        <Sk width={20} height={20} className="w-sk-round" />
        <span className="w-name">
          <Sk kind="text" width={150} />
        </span>
      </span>
      <span className="w-credits num" data-label="Credits">
        <Sk kind="text" width={40} />
      </span>
      <span className="w-paid">
        <span className="w-cost">
          <span className="w-figure num">
            <Sk kind="text" width={52} />
          </span>
        </span>
      </span>
      <span className="w-note-text muted" />
      <RowActions remove />
    </li>
  );
}

function TopUpsCard() {
  return (
    <section className="provider w-topups" aria-hidden="true">
      <header>
        <h2>Top-Ups</h2>
      </header>
      <div className="w-card">
        <div className="w-colhead">
          <span>Date</span>
          <span>Account</span>
          <span>Credits</span>
          <span>Price</span>
          <span>Note</span>
          <span />
        </div>
        <ul className="w-rows">
          {[0, 1, 2].map((index) => (
            <TopUpRow key={index} />
          ))}
        </ul>
      </div>
    </section>
  );
}

/** The Wallet before the first load: the page's own chrome for real, placeholders where figures and names go. */
export function WalletSkeleton() {
  return (
    <div aria-busy="true" className="w-page">
      <LoadingNote>Loading wallet</LoadingNote>
      <Tools />
      <Band />
      <div className="w-glance">
        <SpendCard />
        <div className="w-side" aria-hidden="true">
          <TopUpsGlance />
          <RenewalsGlance />
        </div>
      </div>
      <AccountsCard />
      <TopUpsCard />
    </div>
  );
}
