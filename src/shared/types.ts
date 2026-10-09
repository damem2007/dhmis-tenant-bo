import type { ScheduleItem } from "../apps/back-office/ClinicalDashboard";
export interface Patient {
  id: string;
  first_name: string;
  last_name: string;
  birth_date: string;
  email: string;
  phone: string;
  location_id: string;
  allergies: string[];
  medical_history: string;
  dental_history: string;
  alerts: string[];
}
export interface Appointment {
  id: string;
  patient_id: string;
  provider_id: string;
  location_id: string;
  chair: string;
  starts_at: string;
  ends_at: string;
  procedure: string;
  status: string;
}
export interface Service {
  id: string;
  code: string;
  name: string;
  fee_cents: number;
  description: string;
}
export interface Invoice {
  id: string;
  patient_id: string;
  total_cents: number;
  paid_cents: number;
  adjustment_cents: number;
  status: string;
  lines: { name: string; fee_cents: number }[];
}
export interface Claim {
  id: string;
  invoice_id: string;
  location_id: string;
  status: string;
  network: string;
  reference: string;
  submitted_cents: number;
  covered_cents: number;
  created_at: string;
}
export interface Reference {
  locations: {
    id: string;
    name: string;
    chairs: string[];
    timezone: string;
    opening_hour: number;
    closing_hour: number;
    branding: Record<string, string>;
    policy: Record<string, number>;
  }[];
  providers: { id: string; name: string }[];
}
export interface User {
  id: string;
  name: string;
  role: string;
  selected_location_id?: string | null;
  assignments?: {
    id: string;
    location_id: string | null;
    scope: 'organization' | 'location';
    role: string;
  }[];
  organization_id: string;
  organization_name: string;
  permissions: string[];
  mfa_enabled?: boolean;
  branding: Record<string, string>;
  photo_url?: string;
  local_password?: boolean;
}
export interface Dashboard {
  location_name: string;
  date_label: string;
  patient_count: number;
  balance_cents: number | null;
  pending_claims: number | null;
  schedule: ScheduleItem[];
}
export interface PerioSite {
  depths: number[];
  bleeding: boolean[];
  recession: number[];
  furcation: number;
  mobility: number;
}
export interface Procedure {
  service_id: string;
  quantity: number;
  tooth?: string | null;
}
export interface TreatmentPhase {
  name: string;
  procedures: Procedure[];
}
export interface TreatmentOption {
  name: string;
  phases: TreatmentPhase[];
  total_cents?: number;
  estimated_patient_cents?: number;
  estimated_insurance_cents?: number;
}
export interface TreatmentPlan {
  id: string;
  title: string;
  status: string;
  options: TreatmentOption[];
  accepted_option: number | null;
  consent_id: string | null;
}
export interface Encounter {
  id: string;
  status: string;
  care_setting?: string;
  soap: Record<string, string>;
  procedures: Procedure[];
  invoice_id: string | null;
}
export interface Chart {
  entries: {
    id: string;
    tooth: string;
    surface: string;
    condition: string;
    notes: string;
    created_at: string;
  }[];
  perio_exams: {
    id: string;
    measurements: Record<string, PerioSite>;
    dentition: string[];
    status: string;
    created_at: string;
  }[];
  perio_comparison: Record<string, number[]>;
  encounters: Encounter[];
  treatment_plans: TreatmentPlan[];
}
export interface InsurancePlan {
  id: string;
  patient_id: string;
  payer_name: string;
  member_id: string;
  priority: number;
  coverage_pct: number;
  maximum_cents: number;
  used_cents: number;
}
export interface Audit {
  id: string;
  created_at: string;
  created_by: string;
  action: string;
  resource: string;
}
export interface Consent {
  id: string;
  title: string;
  status: string;
}
