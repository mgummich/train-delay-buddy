import { useState, useId, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import { Switch } from '@/components/ui/switch'
import { AppBar } from '@/components/AppBar'
import { PlausibilityDialog } from '@/components/PlausibilityDialog'
import { InstallBanner } from '@/components/InstallBanner'
import { useTrainValidation } from '@/hooks/useTrainValidation'
import { useStationSearch } from '@/hooks/useStationSearch'
import { apiClient } from '@/api/client'
import { useJourneyStore } from '@/store/journeyStore'

const schema = z.object({
  trainNumber: z.string().min(3, 'Zugnummer eingeben'),
  destination: z.object({
    id:   z.string(),
    name: z.string(),
  }, { required_error: 'Zielbahnhof wählen' }),
  onTrain: z.boolean(),
})

type FormValues = z.infer<typeof schema>

function IconBolt({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  )
}

function IconTrain({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="3" width="16" height="13" rx="3" />
      <path d="M4 13h16M8 13v5M16 13v5M6 18h12" />
      <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" />
      <circle cx="15.5" cy="8.5" r="1.5" fill="currentColor" />
    </svg>
  )
}

function IconPin({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s-8-6.5-8-12a8 8 0 1 1 16 0c0 5.5-8 12-8 12z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  )
}

export function StartScreen() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { setJourney } = useJourneyStore()
  const [plausibilityOpen, setPlausibilityOpen]   = useState(false)
  const [pendingJourneyId, setPendingJourneyId]   = useState<string | null>(null)
  const trainValidation = useTrainValidation()
  const stationSearch   = useStationSearch()
  const [showStationDropdown, setShowStationDropdown] = useState(false)
  const dropdownRef  = useRef<HTMLDivElement>(null)
  const trainInputId = useId()
  const destInputId  = useId()

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowStationDropdown(false)
      }
    }
    if (showStationDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showStationDropdown])

  const form = useForm<FormValues>({
    resolver:      zodResolver(schema),
    defaultValues: { trainNumber: '', onTrain: true },
  })

  function handleTrainBlur() {
    const val = form.getValues('trainNumber')
    trainValidation.validate(val)
  }

  async function onSubmit(values: FormValues) {
    const idempotencyKey = crypto.randomUUID()
    const { data, error } = await apiClient.POST('/journeys', {
      body: {
        trainNumber:    values.trainNumber.trim().toUpperCase(),
        destination:    values.destination.id,
        iAmOnThisTrain: values.onTrain,
        filters: {
          dbOnly:       true,
          maxTransfers: null,
          safetyLevel:  'normal',
        },
      },
      headers: { 'Idempotency-Key': idempotencyKey },
    })

    if (error) {
      const prob = error as { errors?: Array<{ field: string; message: string }> }
      const validFields = new Set<keyof FormValues>(['trainNumber', 'destination', 'onTrain'])
      prob.errors?.forEach(({ field, message }) => {
        if (validFields.has(field as keyof FormValues)) {
          form.setError(field as keyof FormValues, { message })
        }
      })
      return
    }

    if (!data) return

    setJourney(data.journeyId, null)

    if (data.plausibility.onTrainConfidence !== 'high') {
      setPendingJourneyId(data.journeyId)
      setPlausibilityOpen(true)
    } else {
      void navigate(`/journey/${data.journeyId}/alternatives`)
    }
  }

  function handlePlausibilityConfirm() {
    setPlausibilityOpen(false)
    if (pendingJourneyId) void navigate(`/journey/${pendingJourneyId}/alternatives`)
  }

  function handlePlausibilityDeny() {
    setPlausibilityOpen(false)
    form.setValue('onTrain', false)
  }

  const canSubmit =
    form.formState.isValid &&
    trainValidation.trainData !== null &&
    !trainValidation.isValidating &&
    !form.formState.isSubmitting &&
    !trainValidation.error

  return (
    <div className="min-h-screen bg-bg-app">
      <AppBar />
      <InstallBanner />

      <div className="px-4 pt-2 pb-8 flex flex-col gap-6">
        <div className="flex flex-col gap-[10px] mt-2">
          <span className="inline-flex items-center gap-[6px] self-start
            bg-accent-soft text-accent text-[12.5px] font-semibold
            px-3 py-1 rounded-badge">
            <IconBolt size={13} />
            {t('start.eyebrow')}
          </span>

          <h1 className="font-display font-bold text-[26px] leading-[1.18]
            tracking-[-0.01em] text-text-primary max-w-[15ch]">
            {t('start.title')}
          </h1>

          <p className="text-text-muted text-[15px] leading-[1.5] max-w-[32ch]">
            {t('start.subtitle')}
          </p>

          <div className="flex items-start gap-[7px] mt-[2px]">
            <svg className="text-text-faint flex-shrink-0 mt-[1px]" width="15" height="15"
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
              <circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8v.5" />
            </svg>
            <p className="text-text-faint text-[12.5px] leading-[1.45] max-w-[34ch]">
              {t('start.infoLine')}
            </p>
          </div>
        </div>

        <form onSubmit={(e) => { void form.handleSubmit(onSubmit)(e) }} noValidate>
          <div className="bg-bg-card rounded-card border border-border-subtle shadow-card
            p-4 flex flex-col gap-4">

            {/* Train number */}
            <div className="flex flex-col gap-[6px]">
              <label htmlFor={trainInputId}
                className="text-[13px] font-semibold text-text-muted">
                {t('start.trainField')}
              </label>
              <div className={`flex items-center gap-3 h-[48px] px-3
                border-[1.5px] rounded-input bg-bg-card transition-colors duration-fast
                ${form.formState.errors.trainNumber || trainValidation.error
                  ? 'border-warn'
                  : 'border-border-strong focus-within:border-accent'}`}>
                <span className="text-text-faint"><IconTrain /></span>
                <input
                  id={trainInputId}
                  aria-label={t('start.trainField')}
                  type="text"
                  inputMode="text"
                  autoCapitalize="characters"
                  placeholder="ICE 123"
                  className="flex-1 bg-transparent outline-none text-text-primary
                    text-[16px] tnum placeholder:text-text-faint"
                  {...form.register('trainNumber', {
                    onBlur:   handleTrainBlur,
                    onChange: () => trainValidation.reset(),
                  })}
                />
                {trainValidation.isValidating && (
                  <span className="text-text-faint text-xs">…</span>
                )}
              </div>
              {(form.formState.errors.trainNumber || trainValidation.error) && (
                <p className="text-warn text-[12.5px]">
                  {form.formState.errors.trainNumber?.message ?? trainValidation.error}
                </p>
              )}
            </div>

            {/* Destination */}
            <div className="flex flex-col gap-[6px] relative">
              <label htmlFor={destInputId}
                className="text-[13px] font-semibold text-text-muted">
                {t('start.destinationField')}
              </label>
              <div className={`flex items-center gap-3 h-[48px] px-3
                border-[1.5px] rounded-input bg-bg-card transition-colors duration-fast
                ${form.formState.errors.destination
                  ? 'border-warn' : 'border-border-strong focus-within:border-accent'}`}>
                <span className="text-text-faint"><IconPin /></span>
                <input
                  id={destInputId}
                  aria-label={t('start.destinationField')}
                  type="text"
                  placeholder="Göttingen"
                  className="flex-1 bg-transparent outline-none text-text-primary text-[16px] placeholder:text-text-faint"
                  onChange={(e) => {
                    stationSearch.search(e.target.value)
                    setShowStationDropdown(true)
                    form.setValue('destination', undefined as unknown as FormValues['destination'])
                  }}
                />
              </div>

              {showStationDropdown && stationSearch.stations.length > 0 && (
                <div ref={dropdownRef} className="absolute top-full left-0 right-0 mt-1 bg-bg-card
                  rounded-card shadow-lift border border-border-subtle z-10 overflow-hidden">
                  {stationSearch.stations.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className="w-full text-left px-4 py-3 text-[15px] text-text-primary
                        hover:bg-bg-subtle border-b border-border-subtle last:border-0"
                      onClick={() => {
                        form.setValue('destination', s, { shouldValidate: true })
                        stationSearch.clear()
                        setShowStationDropdown(false)
                        const el = document.getElementById(destInputId) as HTMLInputElement | null
                        if (el) el.value = s.name
                      }}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              )}

              {form.formState.errors.destination && (
                <p className="text-warn text-[12.5px]">
                  {String(form.formState.errors.destination.message ?? '')}
                </p>
              )}
            </div>

            <hr className="border-border-subtle" />

            {/* On-train toggle */}
            <div className="flex items-start gap-3">
              <div className="flex-1 flex flex-col gap-[2px]">
                <span className="text-[15px] font-semibold text-text-primary">
                  {t('start.onTrainToggle')}
                </span>
                <span className="text-text-muted text-[13px] leading-[1.4]">
                  {t('start.onTrainSub')}
                </span>
              </div>
              <Controller
                name="onTrain"
                control={form.control}
                render={({ field }) => (
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    aria-label={t('start.onTrainToggle')}
                  />
                )}
              />
            </div>
          </div>

          <div className="flex flex-col gap-[14px] items-center mt-4">
            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full h-[50px] bg-accent text-accent-ink rounded-btn font-semibold
                text-[15px] disabled:opacity-40 active:scale-[0.97] transition-all duration-fast"
            >
              {form.formState.isSubmitting ? '…' : t('start.submitBtn')}
            </button>
            <button type="button" disabled className="text-accent text-[14px] opacity-50 cursor-not-allowed">
              {t('start.secondaryLink')}
            </button>
          </div>
        </form>
      </div>

      <PlausibilityDialog
        open={plausibilityOpen}
        onConfirm={handlePlausibilityConfirm}
        onDeny={handlePlausibilityDeny}
      />
    </div>
  )
}
