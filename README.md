# CareConnect

CareConnect is a static, multi-page HTML5/CSS/vanilla JavaScript frontend. It has no React, Vite, Node runtime, TypeScript, or build step. Serve this folder with VS Code Live Server or another static web server and open `index.html`.

## Pages

- `index.html`: landing page and approved doctors
- `auth.html`, `reset-password.html`, `onboarding.html`: Supabase authentication and profile setup
- `doctors.html`, `appointments.html`, `profile.html`: patient browsing and account pages
- `doctor-dashboard.html`, `doctor-requests.html`, `doctor-availability.html`, `doctor-profile.html`: approved doctor workspace
- `apply-doctor.html`: doctor application and review status
- `admin.html`: application review and clinic appointments

## Supabase setup

The supplied project URL and publishable key are in `js/config.js`. The publishable key is intended for browser use; never put a Supabase `service_role` key in this project. The Supabase JS v2 UMD library is loaded from jsDelivr in each page.

The frontend expects these Supabase tables and columns. Use UUID primary keys and timestamps/date/time types as appropriate:

- `profiles`: `id` (same UUID as `auth.users.id`), `full_name`, `phone`, `date_of_birth`, `gender`, `city`, `address`, `avatar_url`, `role` (`patient`, `doctor_applicant`, `doctor`, or `admin`)
- `doctor_applications`: `id`, `user_id`, `name` (legacy required name), `full_name`, `specialty`, `qualifications`, `experience_years`, `consultation_fee`, `clinic_address`, `bio`, `status` (`pending`, `approved`, `rejected`), `review_note`, `created_at`
- `doctors`: `id`, `user_id`, `full_name`, `specialty`, `qualifications`, `experience_years`, `consultation_fee`, `clinic_address`, `bio`, `city`, `status` (`approved` for public listing)
- `doctor_availability`: `id`, `doctor_id`, `available_date`, `start_time`, `end_time`, `slot_duration` (30)
- `appointments`: `id`, `patient_id`, `doctor_id`, `availability_id`, `appointment_date`, `slot_time`, `reason`, `status` (`pending`, `confirmed`, `rejected`, `cancelled`)

Create the `avatars` Storage bucket for profile uploads. Configure the Auth site's URL and redirect allowlist to include the static site's URL and `reset-password.html`.

### Repairing the existing profiles table

The current project database is missing some profile, doctor, and availability columns and does not grant authenticated users the required reads. Run [`supabase/profile-access.sql`](./supabase/profile-access.sql) in the Supabase SQL Editor. It adds the profile, doctor, availability, and appointment fields used by the app, creates the doctor application table with applicant/admin RLS policies, configures doctor-row access for public approved profiles, owners, and admins, adds patient/doctor/admin appointment and availability access policies, and provides restricted RPCs for profile completion and admin doctor-role approval. It assumes `profiles.id`, `role`, and `full_name` already exist. Review any existing permissive policies before production use.

**Before using real users or patient data, configure and test Row Level Security policies** for every table and the storage bucket. Patients should only read/update their own profile and appointments; doctors should only manage their own doctor profile, availability, and requests; only trusted admins should review applications or read clinic-wide appointments. Do not let users grant themselves `doctor` or `admin` roles by editing their profile; assign privileged roles through trusted server-side logic or tightly restricted admin policies. The browser client is not an authorization boundary. Enforce unique availability dates as desired and prevent duplicate active appointments with a database constraint or transaction/RPC; the UI rechecks slots, but client checks alone cannot prevent concurrent bookings.

## Troubleshooting

If data does not load, check the browser console, table/column names, Supabase Auth redirect URLs, and RLS policies. `file://` may block browser auth/storage behavior; use a static HTTP server such as VS Code Live Server instead. No install or build command is required.
