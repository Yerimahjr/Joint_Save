"use client"

import { useState, useEffect } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2, ArrowUpRight, ArrowDownLeft, AlertCircle, CheckCircle2 } from "lucide-react"
import { useStellar } from "@/components/web3-provider"
import {
  useRotationalDeposit, useTriggerPayout,
  useTargetContribute, useTargetWithdraw, useTargetRefund,
  useFlexibleDeposit, useFlexibleWithdraw,
  fetchRotationalState,
} from "@/hooks/useJointSaveContracts"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface GroupActionsProps {
  groupId: string
  poolAddress: string
  poolType: "rotational" | "target" | "flexible"
  tokenAddress: string
}

async function logActivity(poolId: string, type: string, userAddress: string, amount: string | null, txHash: string) {
  try {
    await fetch("/api/pools", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: poolId,
        activity: { activity_type: type, user_address: userAddress, amount: amount ? parseFloat(amount) : null, tx_hash: txHash },
      }),
    })
  } catch {}
}

export function GroupActions({ groupId, poolAddress, poolType }: GroupActionsProps) {
  const { address } = useStellar()
  const [depositAmount, setDepositAmount] = useState("")
  const [withdrawAmount, setWithdrawAmount] = useState("")
  const [error, setError] = useState("")
  const [successMsg, setSuccessMsg] = useState("")

  // Pool metadata from Supabase
  const [poolData, setPoolData] = useState<any>(null)
  
  // Modal Preview states
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [isConfirmLoading, setIsConfirmLoading] = useState(false)
  const [previewData, setPreviewData] = useState<{
    type: "withdraw" | "payout"
    amount: number
    details: { label: string; value: string; isDeduction?: boolean }[]
    onConfirm: () => Promise<void>
  } | null>(null)

  useEffect(() => {
    if (!groupId) return
    fetch(`/api/pools?id=${groupId}`)
      .then(res => res.json())
      .then(data => setPoolData(data))
      .catch(err => console.error("Failed to load pool details:", err))
  }, [groupId])

  const rotationalDeposit = useRotationalDeposit(poolAddress)
  const triggerPayout = useTriggerPayout(poolAddress)
  const targetContribute = useTargetContribute(poolAddress, depositAmount)
  const targetWithdraw = useTargetWithdraw(poolAddress)
  const targetRefund = useTargetRefund(poolAddress)
  const flexibleDeposit = useFlexibleDeposit(poolAddress, depositAmount)
  const flexibleWithdraw = useFlexibleWithdraw(poolAddress, withdrawAmount)

  const isPending = !poolAddress || poolAddress === "pending_deployment"

  const handleDeposit = async () => {
    setError(""); setSuccessMsg("")
    if (!address) return setError("Please connect your wallet first")
    if (isPending) return setError("Contract not yet deployed.")
    try {
      let txHash: string | undefined
      if (poolType === "rotational") txHash = await rotationalDeposit.deposit()
      else if (poolType === "target") txHash = await targetContribute.contribute()
      else txHash = await flexibleDeposit.deposit()

      if (txHash) {
        await logActivity(groupId, "deposit", address, depositAmount || null, txHash)
        setSuccessMsg("Deposit successful!")
        setDepositAmount("")
      }
    } catch (e: any) { setError(e.message || "Transaction failed") }
  }

  const handleWithdrawClick = async () => {
    setError(""); setSuccessMsg("")
    if (!address) return setError("Please connect your wallet first")
    if (isPending) return setError("Contract not yet deployed.")
    
    if (poolType === "target") {
      // Direct withdrawal since target pool exit has no fee parameters stored/previewed
      try {
        const txHash = await targetWithdraw.withdraw()
        if (txHash) {
          await logActivity(groupId, "withdraw", address, null, txHash)
          setSuccessMsg("Withdrawal successful!")
        }
      } catch (e: any) { setError(e.message || "Transaction failed") }
    } else {
      // Flexible withdrawal preview
      const amount = parseFloat(withdrawAmount)
      if (isNaN(amount) || amount <= 0) return setError("Please enter a valid withdrawal amount")

      const feePercent = poolData?.withdrawal_fee ?? 0
      const feeAmount = amount * (feePercent / 100)
      const netAmount = amount - feeAmount

      setPreviewData({
        type: "withdraw",
        amount,
        details: [
          { label: "Withdraw Amount", value: `${amount.toFixed(2)} XLM` },
          { label: `Withdrawal Fee (${feePercent}%)`, value: `-${feeAmount.toFixed(2)} XLM`, isDeduction: true },
          { label: "Net Amount You Receive", value: `${netAmount.toFixed(2)} XLM` },
        ],
        onConfirm: async () => {
          const txHash = await flexibleWithdraw.withdraw()
          if (txHash) {
            await logActivity(groupId, "withdraw", address, withdrawAmount || null, txHash)
            setSuccessMsg("Withdrawal successful!")
            setWithdrawAmount("")
          }
        }
      })
      setIsPreviewOpen(true)
    }
  }

  const handleTriggerPayoutClick = async () => {
    setError(""); setSuccessMsg("")
    if (!address) return setError("Please connect your wallet first")
    if (isPending) return setError("Contract not yet deployed.")

    setPreviewLoading(true)
    try {
      // Fetch rotational pool state on-chain
      const state = await fetchRotationalState(poolAddress)
      const depositCount = state.depositCount
      const currentRound = state.currentRound
      const members = state.members
      const beneficiary = members[currentRound] || "Unknown beneficiary"

      const contribution = parseFloat(poolData?.contribution_amount ?? "0")
      const totalCollected = contribution * depositCount
      const treasuryCut = totalCollected * 0.01 // 1% treasury fee
      const relayerCut = totalCollected * 0.005 // 0.5% relayer fee
      const payoutAmount = totalCollected - treasuryCut - relayerCut

      const shortAddress = (addr: string) =>
        addr.length > 12 ? `${addr.slice(0, 6)}...${addr.slice(-6)}` : addr

      setPreviewData({
        type: "payout",
        amount: totalCollected,
        details: [
          { label: "Total Collected (Depositors)", value: `${totalCollected.toFixed(2)} XLM (${depositCount}/${members.length} paid)` },
          { label: "Treasury Fee (1%)", value: `-${treasuryCut.toFixed(2)} XLM`, isDeduction: true },
          { label: "Relayer Fee (0.5%)", value: `-${relayerCut.toFixed(2)} XLM`, isDeduction: true },
          { label: "Net Recipient Payout", value: `${payoutAmount.toFixed(2)} XLM` },
          { label: "Beneficiary Address", value: shortAddress(beneficiary) },
          { label: "Your Relayer Reward (expected)", value: `${relayerCut.toFixed(2)} XLM` },
        ],
        onConfirm: async () => {
          const txHash = await triggerPayout.trigger()
          if (txHash) {
            await logActivity(groupId, "payout", address, null, txHash)
            setSuccessMsg("Payout triggered!")
          }
        }
      })
      setIsPreviewOpen(true)
    } catch (e: any) {
      setError(e.message || "Failed to load payout details")
    } finally {
      setPreviewLoading(false)
    }
  }

  const handleRefund = async () => {
    setError(""); setSuccessMsg("")
    if (!address) return setError("Please connect your wallet first")
    if (isPending) return setError("Contract not yet deployed.")
    try {
      const txHash = await targetRefund.refund()
      if (txHash) {
        await logActivity(groupId, "refund", address, null, txHash)
        setSuccessMsg("Refund initiated!")
      }
    } catch (e: any) { setError(e.message || "Transaction failed") }
  }

  const isDepositLoading =
    poolType === "rotational" ? rotationalDeposit.isLoading
    : poolType === "target" ? targetContribute.isLoading
    : flexibleDeposit.isLoading

  const isWithdrawLoading = poolType === "target" ? targetWithdraw.isLoading : flexibleWithdraw.isLoading
  const isRotational = poolType === "rotational"
  const isTarget = poolType === "target"
  const isFlexible = poolType === "flexible"

  return (
    <>
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">Quick Actions</h3>

        {error && (
          <div className="flex gap-2 p-3 rounded-lg bg-destructive/10 text-destructive mb-4">
            <AlertCircle className="h-5 w-5 flex-shrink-0" />
            <p className="text-sm">{error}</p>
          </div>
        )}

        {successMsg && (
          <div className="flex gap-2 p-3 rounded-lg bg-primary/10 text-primary mb-4">
            <CheckCircle2 className="h-5 w-5 flex-shrink-0" />
            <p className="text-sm">{successMsg}</p>
          </div>
        )}

        {isPending && (
          <div className="p-3 rounded-lg bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 mb-4 text-sm">
            Contract pending deployment.
          </div>
        )}

        <div className="space-y-6">
          {/* Deposit / Contribute */}
          <div className="space-y-3">
            <Label htmlFor="deposit">
              {isRotational ? "Deposit Fixed Amount" : isTarget ? "Contribute Amount (XLM)" : "Deposit Amount (XLM)"}
            </Label>
            {!isRotational && (
              <Input id="deposit" type="number" step="0.01" placeholder="100"
                value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)}
                disabled={isDepositLoading} />
            )}
            <p className="text-xs text-muted-foreground">
              {isRotational && "Deposit the fixed pool amount. Same for all members."}
              {isTarget && "Contribute any amount toward the target goal."}
              {isFlexible && "Deposit any amount (must meet minimum). Withdraw anytime."}
            </p>
            <Button className="w-full bg-primary hover:bg-primary/90" onClick={handleDeposit}
              disabled={isDepositLoading || !address || isPending}>
              {isDepositLoading
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Processing...</>
                : <><ArrowUpRight className="mr-2 h-4 w-4" />{isTarget ? "Contribute" : "Deposit"}</>}
            </Button>
          </div>

          {/* Withdraw */}
          {!isRotational && (
            <div className="border-t border-border pt-6 space-y-3">
              <Label htmlFor="withdraw">{isTarget ? "Withdraw Share" : "Withdraw Amount (XLM)"}</Label>
              {isFlexible && (
                <Input id="withdraw" type="number" step="0.01" placeholder="100"
                  value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)}
                  disabled={isWithdrawLoading} />
              )}
              <p className="text-xs text-muted-foreground">
                {isTarget && "Withdraw after target reached. Exit fee deducted."}
                {isFlexible && "Withdraw anytime. Exit fee will be deducted."}
              </p>
              <Button variant="outline" className="w-full bg-transparent" onClick={handleWithdrawClick}
                disabled={isWithdrawLoading || !address || isPending || (isFlexible && !withdrawAmount)}>
                {isWithdrawLoading
                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Processing...</>
                  : <><ArrowDownLeft className="mr-2 h-4 w-4" />Withdraw</>}
              </Button>

              {isTarget && (
                <Button variant="ghost" className="w-full text-destructive hover:text-destructive" onClick={handleRefund}
                  disabled={targetRefund.isLoading || !address || isPending}>
                  {targetRefund.isLoading
                    ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Processing...</>
                    : "Refund (if deadline passed)"}
                </Button>
              )}
            </div>
          )}

          {/* Rotational payout trigger */}
          {isRotational && (
            <div className="border-t border-border pt-6 space-y-3">
              <p className="text-xs text-muted-foreground">
                Rotational Pool: Payouts are triggered when the round time is reached. You earn a relayer fee for triggering.
              </p>
              <Button variant="outline" className="w-full bg-transparent" onClick={handleTriggerPayoutClick}
                disabled={triggerPayout.isLoading || previewLoading || !address || isPending}>
                {triggerPayout.isLoading || previewLoading
                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{previewLoading ? "Calculating Preview..." : "Processing..."}</>
                  : <><ArrowDownLeft className="mr-2 h-4 w-4" />Trigger Payout</>}
              </Button>
            </div>
          )}

          <div className="border-t border-border pt-6">
            <p className="text-xs text-muted-foreground mb-2">Your Stellar address</p>
            <p className="text-sm font-mono bg-muted/30 p-2 rounded break-all">
              {address || "Not connected"}
            </p>
          </div>
        </div>
      </Card>

      <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <DialogContent className="sm:max-w-[425px] bg-background border border-border">
          <DialogHeader>
            <DialogTitle>
              {previewData?.type === "withdraw" ? "Confirm Withdrawal" : "Confirm Rotational Payout"}
            </DialogTitle>
            <DialogDescription>
              {previewData?.type === "withdraw"
                ? "Review the estimated transaction details and fee breakdown below before signing."
                : "Review the estimated payouts and relayer rewards for this round before triggering."}
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-4">
            <div className="rounded-lg border border-border p-4 bg-muted/20 space-y-3">
              {previewData?.details.map((detail, idx) => {
                const isLast = idx === previewData.details.length - 1;
                return (
                  <div
                    key={idx}
                    className={`flex justify-between items-start gap-4 text-sm ${
                      isLast
                        ? "pt-3 border-t border-border font-semibold text-foreground text-base"
                        : "text-muted-foreground"
                    }`}
                  >
                    <span>{detail.label}</span>
                    <span
                      className={`${
                        detail.isDeduction
                          ? "text-destructive font-medium"
                          : isLast
                          ? "text-primary font-bold"
                          : "text-foreground font-medium"
                      } break-all font-mono`}
                    >
                      {detail.value}
                    </span>
                  </div>
                );
              })}
            </div>

            {previewData?.type === "payout" && (
              <p className="text-xs text-muted-foreground text-center">
                Triggering the payout earns you the relayer fee reward directly in your wallet.
              </p>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setIsPreviewOpen(false)} disabled={isConfirmLoading}>
              Cancel
            </Button>
            <Button
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
              onClick={async () => {
                setIsConfirmLoading(true);
                setError("");
                setSuccessMsg("");
                try {
                  if (previewData?.onConfirm) {
                    await previewData.onConfirm();
                  }
                  setIsPreviewOpen(false);
                } catch (e: any) {
                  setError(e.message || "Transaction failed");
                  setIsPreviewOpen(false);
                } finally {
                  setIsConfirmLoading(false);
                }
              }}
              disabled={isConfirmLoading}
            >
              {isConfirmLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Signing...
                </>
              ) : (
                "Confirm & Sign"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
