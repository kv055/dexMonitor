package bitcoin

import (
	"fmt"
	"time"
)

// FeeAnalyzer processes network data to derive fee predictions
type FeeAnalyzer struct {
	feeEstimate  *FeeEstimate
	mempoolData  *MempoolData
	networkStats *NetworkStats
}

// NewFeeAnalyzer creates a new fee analyzer
func NewFeeAnalyzer() *FeeAnalyzer {
	return &FeeAnalyzer{}
}

// AnalyzeFeeDistribution analyzes current fee distribution in mempool
func (fa *FeeAnalyzer) AnalyzeFeeDistribution(data *MempoolData) error {
	if data == nil {
		return fmt.Errorf("mempool data cannot be nil")
	}

	fa.mempoolData = data

	if data.AverageFeeRate == 0 && data.MinFeeRate == 0 && data.MaxFeeRate == 0 {
		return fmt.Errorf("invalid fee distribution data")
	}

	return nil
}

// CalculateVirtualSize calculates transaction virtual size (vB) accounting for SegWit.
// Supported txType values: "P2PKH", "P2SH", "P2WPKH", "P2WSH", "P2TR".
func (fa *FeeAnalyzer) CalculateVirtualSize(inputCount int, outputCount int, txType string) int64 {
	// Base overhead: version(4) + input count varint(1) + output count varint(1) + locktime(4)
	baseSize := int64(10)

	switch txType {
	case "P2PKH", "P2SH":
		baseSize += int64(inputCount) * 150
	case "P2WPKH":
		baseSize += int64(inputCount) * 68
	case "P2WSH":
		baseSize += int64(inputCount) * 70
	case "P2TR":
		baseSize += int64(inputCount) * 65
	default:
		baseSize += int64(inputCount) * 150
	}

	// Each output: value(8) + script pubkey length + script (~25 bytes average)
	baseSize += int64(outputCount) * 34

	virtualSize := baseSize
	if txType == "P2WPKH" || txType == "P2WSH" || txType == "P2TR" {
		// SegWit discount: 3:1 weight ratio → ~25% reduction
		virtualSize = baseSize * 3 / 4
	}

	return virtualSize
}

// EstimateFeeForSpeed returns the fee rate for a given block confirmation target.
func (fa *FeeAnalyzer) EstimateFeeForSpeed(feeEstimate *FeeEstimate, target int) int64 {
	if feeEstimate == nil {
		return 0
	}
	switch {
	case target <= 1:
		return feeEstimate.ExpressFee
	case target <= 2:
		return feeEstimate.FastFee
	case target <= 6:
		return feeEstimate.StandardFee
	default:
		return feeEstimate.EconomicFee
	}
}

// CalculateTransactionFees computes actual fees for all four tiers given a virtual size.
func (fa *FeeAnalyzer) CalculateTransactionFees(txVirtualSize int64, feeEstimate *FeeEstimate) *TransactionCostEstimate {
	if feeEstimate == nil || txVirtualSize == 0 {
		return nil
	}

	const satoshiPerBTC = 100_000_000

	estimate := &TransactionCostEstimate{
		TransactionSize: txVirtualSize,
		Timestamp:       time.Now(),
	}

	estimate.EconomicFeeSat = feeEstimate.EconomicFee * txVirtualSize
	estimate.StandardFeeSat = feeEstimate.StandardFee * txVirtualSize
	estimate.FastFeeSat = feeEstimate.FastFee * txVirtualSize
	estimate.ExpressFeeSat = feeEstimate.ExpressFee * txVirtualSize

	estimate.EconomicFee = float64(estimate.EconomicFeeSat) / satoshiPerBTC
	estimate.StandardFee = float64(estimate.StandardFeeSat) / satoshiPerBTC
	estimate.FastFee = float64(estimate.FastFeeSat) / satoshiPerBTC
	estimate.ExpressFee = float64(estimate.ExpressFeeSat) / satoshiPerBTC

	estimate.EconomicTime = 60 * time.Minute
	estimate.StandardTime = 30 * time.Minute
	estimate.FastTime = 10 * time.Minute
	estimate.ExpressTime = 2 * time.Minute

	estimate.RecommendedTier = "standard"
	estimate.EstimatedConfidence = 0.90

	return estimate
}

// DetermineCongestionLevel classifies network congestion based on mempool size.
func (fa *FeeAnalyzer) DetermineCongestionLevel(stats *NetworkStats) string {
	if stats == nil {
		return "unknown"
	}

	const (
		lowThresholdMB    = 5
		mediumThresholdMB = 50
		highThresholdMB   = 100
	)

	mempoolMB := stats.MempoolSize / (1024 * 1024)

	switch {
	case mempoolMB < lowThresholdMB:
		return "low"
	case mempoolMB < mediumThresholdMB:
		return "low_medium"
	case mempoolMB < highThresholdMB:
		return "medium"
	default:
		return "high"
	}
}

// CalculateConfirmationProbability returns a per-block probability array (indices 0–10)
// for a transaction paying feeRate sat/vB at the current network estimate.
func (fa *FeeAnalyzer) CalculateConfirmationProbability(feeRate int64, estimate *FeeEstimate) []float64 {
	probabilities := make([]float64, 11)

	for i := 0; i <= 10; i++ {
		var p float64
		switch {
		case feeRate >= estimate.ExpressFee:
			p = 1.0 - float64(i)*0.05
		case feeRate >= estimate.FastFee:
			if i <= 2 {
				p = 1.0 - float64(i)*0.1
			} else {
				p = 0.8 - float64(i-2)*0.05
			}
		case feeRate >= estimate.StandardFee:
			if i <= 6 {
				p = 0.9 - float64(i)*0.05
			} else {
				p = 0.6 - float64(i-6)*0.03
			}
		case feeRate >= estimate.EconomicFee:
			p = 0.7 - float64(i)*0.05
		default:
			p = 0.3 - float64(i)*0.02
		}
		if p < 0 {
			p = 0
		}
		if p > 1 {
			p = 1
		}
		probabilities[i] = p
	}

	return probabilities
}

// BlendEstimates applies congestion-based adjustments to fee estimates.
// During high congestion all tiers are buffered +20% and confidence is reduced.
func (fa *FeeAnalyzer) BlendEstimates(estimate *FeeEstimate, stats *NetworkStats) *FeeEstimate {
	if estimate == nil {
		return nil
	}

	if stats != nil && stats.CongestionLevel == "high" {
		estimate.EconomicFee = estimate.EconomicFee * 120 / 100
		estimate.StandardFee = estimate.StandardFee * 120 / 100
		estimate.FastFee = estimate.FastFee * 120 / 100
		estimate.ExpressFee = estimate.ExpressFee * 120 / 100
		estimate.Confidence = estimate.Confidence * 0.9
	}

	return estimate
}

// AnalyzeAndPredict performs full analysis to produce a transaction cost estimate.
func (fa *FeeAnalyzer) AnalyzeAndPredict(feeEstimate *FeeEstimate, stats *NetworkStats, txVirtualSize int64, txType string) *TransactionCostEstimate {
	if feeEstimate == nil {
		return nil
	}

	blendedEstimate := fa.BlendEstimates(feeEstimate, stats)
	costEstimate := fa.CalculateTransactionFees(txVirtualSize, blendedEstimate)

	if costEstimate != nil {
		if stats != nil {
			costEstimate.NetworkCongestion = fa.DetermineCongestionLevel(stats)
		} else {
			costEstimate.NetworkCongestion = "unknown"
		}

		if feeEstimate != nil {
			costEstimate.EstimatedConfidence = feeEstimate.Confidence
		}
	}

	return costEstimate
}
