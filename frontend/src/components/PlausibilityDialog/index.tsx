import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'

interface PlausibilityDialogProps {
  open:      boolean
  onConfirm: () => void
  onDeny:    () => void
}

export function PlausibilityDialog({ open, onConfirm, onDeny }: PlausibilityDialogProps) {
  const { t } = useTranslation()

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onDeny() }}>
      <DialogContent className="bg-bg-card rounded-sheet max-w-sm mx-4">
        <DialogHeader>
          <DialogTitle className="font-display font-semibold text-[20px]">
            {t('start.plausibilityTitle')}
          </DialogTitle>
          <DialogDescription className="text-text-muted text-[14px] mt-2">
            {t('start.plausibilityBody')}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex flex-col gap-3 mt-4">
          <button
            onClick={onConfirm}
            className="w-full h-[50px] bg-accent text-accent-ink rounded-btn font-semibold text-[15px]
              active:scale-[0.97] transition-transform duration-fast"
          >
            {t('start.plausibilityConfirm')}
          </button>
          <button
            onClick={onDeny}
            className="w-full h-[50px] text-text-primary border border-border-strong rounded-btn
              font-semibold text-[15px] active:scale-[0.97] transition-transform duration-fast"
          >
            {t('start.plausibilityDeny')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
