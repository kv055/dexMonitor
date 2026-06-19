import { useEffect, useMemo, useRef, useState } from 'react';
import { ExchangeTag } from './ExchangeTag';
import { formatNum, formatBtc, premiumClass } from '../utils/formatters';
import { useTimezone } from '../hooks/useTimezone';
import { useFilters } from '../hooks/useFilters';
import { LoadingSpinner } from './LoadingSpinner';
import { CostBreakdownPanel, OfferTimeMeta, SizeToggle } from './OfferBreakdownPanel';
import { buildOfferKeys } from '../utils/offerIdentity';
import {
  getBtcMax,
  getBtcMin,
  getCappedTradeSizeBtc,
  getDisplayAbortCost,
  getDisplayCostBreakdown,
  getFirstSeen,
  getFiatMax,
  getFiatMin,
  getLastSeen,
  getNetPremiumPercent,
  getOfferPrice,
  getPriceType,
  getRawPremiumPercent,
  getRefPrice,
  hasCappedScenario,
  isOfferLive,
} from '../utils/offerAccess';

const TH_BASE = "sticky top-0 z-10 bg-surface px-2 py-1 border-b border-border text-muted text-[0.65rem] uppercase text-left whitespace-nowrap";
const TD = "px-2 py-1 whitespace-nowrap";

function useGroupLabel() {
  const { groups } = useFilters();
  return (method: string | null): string => {
    if (!method) return '—';
    const group = groups.find(g => g.methods.includes(method));
    return group ? group.display_name : method;
  };
}

export function OffersPreviewTable() {
  const { filteredOffers: offers, selectedOfferKey, setSelectedOfferKey, loading } = useFilters();
  const groupLabel = useGroupLabel();
  const { timezone } = useTimezone();
  const selectedRowRef = useRef<HTMLTableRowElement>(null);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 1023px)').matches);
  const [cappedSelection, setCappedSelection] = useState<{ offerKey: string | null; enabled: boolean }>({
    offerKey: null,
    enabled: false,
  });
  const offerKeys = useMemo(() => buildOfferKeys(offers), [offers]);
  const showCapped = cappedSelection.offerKey === selectedOfferKey && cappedSelection.enabled;

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)');
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const selectedOfferIndex = selectedOfferKey != null ? offerKeys.indexOf(selectedOfferKey) : -1;
  const selectedOffer = selectedOfferIndex >= 0 ? offers[selectedOfferIndex] : null;
  const hasSelection = selectedOffer !== null;

  useEffect(() => {
    selectedRowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedOfferKey]);

  // ── Mobile layout: vertical stack ─────────────────────────────────────────
  if (isMobile) {
    return (
      <div className="absolute inset-0 flex flex-col overflow-hidden">

        {/* Table — fills remaining height, scrolls vertically */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {loading && offers.length === 0 && <LoadingSpinner size={104} label="Loading offers" />}
          <table className="w-full border-collapse text-[0.72rem]">
            <thead>
              <tr>
                <th className={TH_BASE}>Exch</th>
                <th className={TH_BASE}>Side</th>
                <th className={`${TH_BASE} text-right`}>Prem.</th>
                <th className={`${TH_BASE} text-right`}>Price</th>
                <th className={TH_BASE}>Payment</th>
              </tr>
            </thead>
            <tbody>
              {offers.length === 0 ? (
                !loading && <tr><td colSpan={5} className="p-4 text-center text-muted">No offers</td></tr>
              ) : offers.map((o, index) => {
                const offerKey = offerKeys[index];
                const isSelected = offerKey === selectedOfferKey;
                const rawPremium = getRawPremiumPercent(o);
                return (
                  <tr
                    key={offerKey}
                    ref={isSelected ? selectedRowRef : null}
                    onClick={() => setSelectedOfferKey(isSelected ? null : offerKey)}
                    className={`cursor-pointer transition-colors ${
                      isSelected ? 'offer-row-selected' : 'offer-row-hover'
                    }`}
                  >
                    <td className={`${TD} overflow-hidden`}>
                      <ExchangeTag exchange={o.exchange} />
                    </td>
                    <td className={`${TD} ${o.direction === 'buy' ? 'text-green' : 'text-red'}`}>
                      {o.direction === 'buy' ? 'Bid' : 'Ask'}
                    </td>
                    <td className={`${TD} text-right ${premiumClass(rawPremium)}`}>
                      {rawPremium != null ? rawPremium.toFixed(1) + '%' : '—'}
                    </td>
                    <td className={`${TD} text-right`}>€{formatNum(getOfferPrice(o))}</td>
                    <td className={`${TD} overflow-hidden max-w-32`}>
                      <span className="block overflow-hidden text-ellipsis whitespace-nowrap">
                        {groupLabel(o.payment_method)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Breakdown panel — slides up from bottom when offer is selected */}
        <div
          className="shrink-0 border-t border-border overflow-y-auto transition-all duration-300 ease-in-out"
          style={{
            maxHeight: hasSelection ? '55%' : '0%',
            opacity: hasSelection ? 1 : 0,
          }}
        >
          {selectedOffer && (
            <div className="relative pt-10 px-4 pb-4">
              <button
                onClick={() => setSelectedOfferKey(null)}
                className="absolute top-3 right-3 z-20 w-7 h-7 flex items-center justify-center text-red hover:text-red/70 bg-transparent border-none cursor-pointer text-xl leading-none rounded transition-colors"
                title="Close"
              >
                ×
              </button>
              <OfferTimeMeta firstSeen={getFirstSeen(selectedOffer)} lastSeen={getLastSeen(selectedOffer)} isLive={isOfferLive(selectedOffer)} timezone={timezone} priceType={getPriceType(selectedOffer)} />
              {selectedOffer.payment_method && (
                <div className="mt-1 mb-2 text-[0.68rem] text-muted">
                  <span className="uppercase tracking-wide text-[0.6rem] mr-1">Payment</span>
                  <span className="text-text">{selectedOffer.payment_method}</span>
                </div>
              )}
              {getDisplayCostBreakdown(selectedOffer) ? (
                <div className="flex flex-col gap-3">
                  {hasCappedScenario(selectedOffer) && (
                    <SizeToggle
                      showCapped={showCapped}
                      onToggle={enabled => setCappedSelection({ offerKey: selectedOfferKey, enabled })}
                      cappedBtc={getCappedTradeSizeBtc(selectedOffer)}
                      refPrice={getRefPrice(selectedOffer)}
                    />
                  )}
                  <CostBreakdownPanel
                    bd={getDisplayCostBreakdown(selectedOffer, showCapped) ?? getDisplayCostBreakdown(selectedOffer)!}
                    abortCost={getDisplayAbortCost(selectedOffer, showCapped)}
                    priceDiffPct={getRawPremiumPercent(selectedOffer)}
                    netPremiumPct={getNetPremiumPercent(selectedOffer, showCapped)}
                    refPrice={getRefPrice(selectedOffer)}
                    showCapitalAndAbort={!isOfferLive(selectedOffer)}
                  />
                </div>
              ) : (
                <div className="text-muted text-[0.75rem]">No cost breakdown available for this offer.</div>
              )}
            </div>
          )}
        </div>

      </div>
    );
  }

  // ── Desktop layout: horizontal split ──────────────────────────────────────
  return (
    <div className="absolute inset-0 flex overflow-hidden">

      {/* Left: offers table */}
      <div
        className="overflow-y-auto shrink-0 transition-all duration-300 ease-in-out"
        style={{ width: hasSelection ? '54%' : '100%' }}
      >
        {loading && offers.length === 0 && <LoadingSpinner size={104} label="Loading offers" />}
        <table className={`w-full border-collapse ${hasSelection ? 'text-[0.68rem]' : 'text-[0.72rem]'}`}>
          <thead>
            <tr>
              <th className={`${TH_BASE} ${hasSelection ? 'w-[1%]' : ''}`}>Exch</th>
              <th className={`${TH_BASE} ${hasSelection ? 'w-[1%]' : ''}`}>Side</th>
              <th className={`${TH_BASE} text-right ${hasSelection ? 'w-[1%]' : ''}`}>Prem.</th>
              <th className={`${TH_BASE} text-right ${hasSelection ? 'w-[1%]' : ''}`}>Price</th>
              <th className={`${TH_BASE} text-right ${hasSelection ? 'w-[1%]' : ''}`}>Min BTC</th>
              <th className={`${TH_BASE} text-right ${hasSelection ? 'w-[1%]' : ''}`}>Max BTC</th>
              <th className={`${TH_BASE} text-right ${hasSelection ? 'w-[1%]' : ''}`}>Fiat Min</th>
              <th className={`${TH_BASE} text-right ${hasSelection ? 'w-[1%]' : ''}`}>Fiat Max</th>
              <th className={`${TH_BASE} ${hasSelection ? 'w-[1%]' : ''}`}>Status</th>
              <th className={TH_BASE}>Payment</th>
            </tr>
          </thead>
          <tbody>
            {offers.length === 0 ? (
              !loading && <tr><td colSpan={10} className="p-4 text-center text-muted">No offers</td></tr>
            ) : offers.map((o, index) => {
              const offerKey = offerKeys[index];
              const isSelected = offerKey === selectedOfferKey;
              const rawPremium = getRawPremiumPercent(o);
              return (
                <tr
                  key={offerKey}
                  ref={isSelected ? selectedRowRef : null}
                  onClick={() => setSelectedOfferKey(isSelected ? null : offerKey)}
                  className={`cursor-pointer transition-colors ${
                    isSelected ? 'offer-row-selected' : 'offer-row-hover'
                  }`}
                >
                  <td className={`${TD} overflow-hidden`}>
                    <ExchangeTag exchange={o.exchange} />
                  </td>
                  <td className={`${TD} ${o.direction === 'buy' ? 'text-green' : 'text-red'}`}>
                    {o.direction === 'buy' ? 'Bid' : 'Ask'}
                  </td>
                  <td className={`${TD} text-right ${premiumClass(rawPremium)}`}>
                    {rawPremium != null ? rawPremium.toFixed(1) + '%' : '—'}
                  </td>
                  <td className={`${TD} text-right`}>€{formatNum(getOfferPrice(o))}</td>
                  <td className={`${TD} text-right`}>{formatBtc(getBtcMin(o))}</td>
                  <td className={`${TD} text-right`}>{formatBtc(getBtcMax(o))}</td>
                  <td className={`${TD} text-right`}>
                    {getFiatMin(o) != null ? `€${formatNum(getFiatMin(o))}` : '—'}
                  </td>
                  <td className={`${TD} text-right`}>
                    {getFiatMax(o) != null ? `€${formatNum(getFiatMax(o))}` : '—'}
                  </td>
                  <td className={TD}>
                    {isOfferLive(o)
                      ? <span className="text-green">live</span>
                      : <span className="text-muted">closed</span>
                    }
                  </td>
                  <td className={`${TD} overflow-hidden`}>
                    <span className="block overflow-hidden text-ellipsis whitespace-nowrap">
                      {groupLabel(o.payment_method)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Right: cost breakdown panel */}
      <div
        className="border-l border-border overflow-hidden transition-all duration-300 ease-in-out"
        style={{
          width: hasSelection ? '46%' : '0%',
          opacity: hasSelection ? 1 : 0,
          transform: hasSelection ? 'translateX(0)' : 'translateX(16px)',
        }}
      >
        {selectedOffer && (
          <div className="relative flex flex-col h-full overflow-hidden">
            <button
              onClick={() => setSelectedOfferKey(null)}
              className="absolute top-1 right-2 z-20 w-5 h-5 flex items-center justify-center text-red hover:text-red/70 bg-transparent border-none cursor-pointer text-lg leading-none rounded transition-colors"
              title="Close"
            >
              ×
            </button>
            <div className="px-4 pt-1.5 pb-1 pr-8 shrink-0">
              <OfferTimeMeta firstSeen={getFirstSeen(selectedOffer)} lastSeen={getLastSeen(selectedOffer)} isLive={isOfferLive(selectedOffer)} timezone={timezone} priceType={getPriceType(selectedOffer)} />
              <div className="mt-1 text-[0.68rem] text-muted" title="Internal offer ID">
                <span className="uppercase tracking-wide text-[0.6rem] mr-1">ID</span>
                <span className="text-text">{selectedOffer.id}</span>
              </div>
              {selectedOffer.payment_method && (
                <div className="mt-1 text-[0.68rem] text-muted">
                  <span className="uppercase tracking-wide text-[0.6rem] mr-1">Payment</span>
                  <span className="text-text">{selectedOffer.payment_method}</span>
                </div>
              )}
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
            {getDisplayCostBreakdown(selectedOffer) ? (
              <div className="flex flex-col gap-3">
                {hasCappedScenario(selectedOffer) && (
                  <SizeToggle
                    showCapped={showCapped}
                    onToggle={enabled => setCappedSelection({ offerKey: selectedOfferKey, enabled })}
                    cappedBtc={getCappedTradeSizeBtc(selectedOffer)}
                    refPrice={getRefPrice(selectedOffer)}
                  />
                )}
                <CostBreakdownPanel
                  bd={getDisplayCostBreakdown(selectedOffer, showCapped) ?? getDisplayCostBreakdown(selectedOffer)!}
                  abortCost={getDisplayAbortCost(selectedOffer, showCapped)}
                  priceDiffPct={getRawPremiumPercent(selectedOffer)}
                  netPremiumPct={getNetPremiumPercent(selectedOffer, showCapped)}
                  refPrice={getRefPrice(selectedOffer)}
                  showCapitalAndAbort={!isOfferLive(selectedOffer)}
                />
              </div>
            ) : (
              <div className="text-muted text-[0.75rem]">No cost breakdown available for this offer.</div>
            )}
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
