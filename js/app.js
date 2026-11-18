(function () {
  const client = window.supabaseClient;
  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));
  const today = () => {
    const now = new Date();
    return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
  };
  const validPhone = (value) => /^[0-9+() -]{7,20}$/.test(value);
  const formatDate = (value) => {
    if (!value) return "Date not set";
    const date = new Date(value + "T12:00:00");
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  };
  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function message(form, text, success) {
    const target = $("[data-form-message]", form);
    if (!target) return;
    target.textContent = text || "";
    target.classList.toggle("success", !!success);
  }
  function toast(text) {
    const el = $("#toast");
    if (!el) return;
    el.textContent = text;
    el.classList.add("show");
    window.setTimeout(() => el.classList.remove("show"), 3200);
  }
  function showError(container, text) {
    if (container) container.replaceChildren(node("p", "empty-state", text));
    console.error(text);
  }
  function readForm(form) {
    return Object.fromEntries(new FormData(form).entries());
  }
  function setFormValues(form, values) {
    Object.keys(values || {}).forEach((key) => {
      const field = form.elements.namedItem(key);
      if (field && values[key] != null) field.value = values[key];
    });
  }
  function badge(status) {
    const label = String(status || "unknown");
    return node("span", "status-badge " + label.toLowerCase(), label.charAt(0).toUpperCase() + label.slice(1));
  }
  function actionButton(label, action, id, extraClass) {
    const button = node("button", "button button-small " + (extraClass || ""), label);
    button.type = "button";
    button.dataset.action = action;
    button.dataset.id = id;
    return button;
  }
  function addText(parent, tag, className, text) {
    const item = node(tag, className, text);
    parent.append(item);
    return item;
  }
  async function requireUser() {
    const user = window.careConnectAuth && window.careConnectAuth.user;
    if (!user) throw new Error("Please sign in to continue.");
    return user;
  }
  async function getDoctor(userId) {
    const { data, error } = await client.from("doctors").select("*").eq("user_id", userId).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Your approved doctor profile could not be found.");
    return data;
  }

  async function initHome() {
    const container = $("#home-doctors");
    if (!container) return;
    const { data, error } = await client.from("doctors").select("*").eq("status", "approved").order("full_name", { ascending: true }).limit(6);
    if (error) {
      console.error("Could not load approved doctors.", error);
      return showError(container, "Approved doctors could not be loaded. Check the Supabase table columns and public read policy.");
    }
    if (!data || !data.length) return showError(container, "No approved doctors are listed yet.");
    container.replaceChildren(...data.map((doctor) => renderDoctorCard(doctor, false)));
  }
  function renderDoctorCard(doctor, allowBooking) {
    const card = node("article", "doctor-card");
    const top = node("div", "doctor-top");
    const avatar = node("div", "doctor-avatar", (doctor.full_name || "Dr").split(/\s+/).slice(-2).map((part) => part[0]).join("").toUpperCase());
    avatar.setAttribute("aria-hidden", "true");
    const details = node("div");
    addText(details, "h3", "", doctor.full_name || "CareConnect doctor");
    addText(details, "p", "", doctor.specialty || "Healthcare professional");
    top.append(avatar, details);
    card.append(top);
    addText(card, "span", "verified", "✓ Approved professional");
    const meta = node("div", "doctor-meta");
    if (doctor.experience_years != null) meta.append(node("span", "tag", doctor.experience_years + " yrs experience"));
    if (doctor.consultation_fee != null) meta.append(node("span", "tag", "Fee: " + doctor.consultation_fee));
    if (doctor.city) meta.append(node("span", "tag", doctor.city));
    card.append(meta);
    if (doctor.qualifications) addText(card, "p", "muted", doctor.qualifications);
    if (allowBooking) {
      const button = node("button", "button", "Check availability");
      button.type = "button";
      button.dataset.bookDoctor = doctor.id;
      card.append(button);
    }
    return card;
  }
  async function initDoctors() {
    const container = $("#doctor-list");
    if (!container) return;
    const search = $("#doctor-search"), specialty = $("#doctor-specialty");
    const initialSpecialty = new URLSearchParams(location.search).get("specialty");
    try {
      const { data, error } = await client.from("doctors").select("*").eq("status", "approved").order("full_name", { ascending: true });
      if (error) throw error;
      const doctors = data || [];
      const specialties = Array.from(new Set(doctors.map((doc) => doc.specialty).filter(Boolean))).sort();
      specialty.replaceChildren(new Option("All specialties", ""), ...specialties.map((name) => new Option(name, name)));
      if (initialSpecialty && specialties.includes(initialSpecialty)) specialty.value = initialSpecialty;
      const render = () => {
        const query = search.value.trim().toLowerCase();
        const filtered = doctors.filter((doc) => {
          const matchesQuery = [doc.full_name, doc.specialty, doc.city].some((value) => String(value || "").toLowerCase().includes(query));
          return matchesQuery && (!specialty.value || doc.specialty === specialty.value);
        });
        if (!filtered.length) return showError(container, "No approved doctors match these filters.");
        container.replaceChildren(...filtered.map((doctor) => renderDoctorCard(doctor, true)));
      };
      search.addEventListener("input", render);
      specialty.addEventListener("change", render);
      container.addEventListener("click", async (event) => {
        const button = event.target.closest("[data-book-doctor]");
        if (!button) return;
        const user = window.careConnectAuth && window.careConnectAuth.user;
        if (!user) { location.href = "auth.html?next=doctors.html"; return; }
        await openBooking(button.dataset.bookDoctor);
      });
      render();
    } catch (error) {
      console.error(error);
      showError(container, "Approved doctors could not be loaded. Check your Supabase connection and database permissions.");
    }
  }

  let bookingDoctorId = "";
  let activeAvailability = [];
  async function openBooking(doctorId) {
    const dialog = $("#booking-dialog");
    const form = $("[data-booking-form]");
    const doctorSelect = form.elements.namedItem("availability_id");
    const slotSelect = form.elements.namedItem("slot");
    const doctorLabel = $("#booking-title");
    const { data: doctor, error: doctorError } = await client.from("doctors").select("id,full_name").eq("id", doctorId).eq("status", "approved").maybeSingle();
    if (doctorError || !doctor) { toast("Doctor profile is unavailable."); console.error(doctorError); return; }
    bookingDoctorId = doctorId;
    form.reset();
    message(form, "", false);
    form.elements.namedItem("doctor_id").value = doctorId;
    doctorLabel.textContent = "Book with " + (doctor.full_name || "your doctor");
    doctorSelect.replaceChildren(new Option("Loading available dates…", ""));
    slotSelect.replaceChildren(new Option("Choose a date first", ""));
    slotSelect.disabled = true;
    dialog.showModal();
    try {
      const { data, error } = await client.from("doctor_availability").select("*").eq("doctor_id", doctorId).gte("available_date", today()).order("available_date", { ascending: true });
      if (error) throw error;
      activeAvailability = data || [];
      doctorSelect.replaceChildren(new Option(activeAvailability.length ? "Choose a date" : "No availability published", ""));
      activeAvailability.forEach((item) => doctorSelect.add(new Option(formatDate(item.available_date) + " · " + item.start_time.slice(0, 5) + "–" + item.end_time.slice(0, 5), item.id)));
    } catch (error) {
      console.error(error);
      doctorSelect.replaceChildren(new Option("Could not load dates", ""));
      message(form, "Could not load availability: " + (error.message || "Unknown Supabase error."));
    }
  }
  function generateSlots(availability) {
    const slots = [];
    const duration = Number(availability.slot_duration || 30);
    const [startHour, startMinute] = availability.start_time.split(":").map(Number);
    const [endHour, endMinute] = availability.end_time.split(":").map(Number);
    let current = startHour * 60 + startMinute;
    const end = endHour * 60 + endMinute;
    while (current + duration <= end) {
      slots.push(String(Math.floor(current / 60)).padStart(2, "0") + ":" + String(current % 60).padStart(2, "0"));
      current += duration;
    }
    return slots;
  }
  async function loadOpenSlots(form) {
    const availabilityId = form.elements.namedItem("availability_id").value;
    const select = form.elements.namedItem("slot");
    const availability = activeAvailability.find((item) => item.id === availabilityId);
    if (!availability) {
      select.replaceChildren(new Option("Choose a date first", ""));
      select.disabled = true;
      return;
    }
    select.disabled = true;
    select.replaceChildren(new Option("Checking open slots…", ""));
    try {
      const { data, error } = await client.from("appointments").select("slot_time,status").eq("availability_id", availabilityId).not("status", "in", '("cancelled","rejected")');
      if (error) throw error;
      const occupied = new Set((data || []).map((appointment) => String(appointment.slot_time).slice(0, 5)));
      const availableSlots = generateSlots(availability).filter((slot) => !occupied.has(slot));
      select.replaceChildren(new Option(availableSlots.length ? "Choose a time" : "No open slots", ""));
      availableSlots.forEach((slot) => select.add(new Option(slot, slot)));
      select.disabled = !availableSlots.length;
    } catch (error) {
      console.error(error);
      select.replaceChildren(new Option("Could not load slots", ""));
      select.disabled = true;
      message(form, "Could not check open slots. Please try again.");
    }
  }
  function initBooking() {
    const form = $("[data-booking-form]");
    if (!form) return;
    form.elements.namedItem("availability_id").addEventListener("change", () => loadOpenSlots(form));
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const user = window.careConnectAuth && window.careConnectAuth.user;
      if (!user) { location.href = "auth.html"; return; }
      const availability = activeAvailability.find((item) => item.id === form.elements.namedItem("availability_id").value);
      const slot = form.elements.namedItem("slot").value;
      if (!availability || !slot) return message(form, "Select a date and open time slot.");
      const button = $("button[type=submit]", form);
      button.disabled = true;
      try {
        await loadOpenSlots(form);
        if (form.elements.namedItem("slot").disabled || !Array.from(form.elements.namedItem("slot").options).some((option) => option.value === slot)) {
          throw new Error("That slot is no longer available. Please choose another.");
        }
        const { error } = await client.from("appointments").insert({
          patient_id: user.id,
          doctor_id: bookingDoctorId,
          availability_id: availability.id,
          date: availability.available_date,
          time: slot,
          appointment_date: availability.available_date,
          slot_time: slot,
          reason: form.elements.namedItem("reason").value.trim(),
          status: "pending"
        });
        if (error) throw error;
        message(form, "Request sent. You can track its status in My appointments.", true);
        toast("Appointment request sent");
        window.setTimeout(() => $("#booking-dialog").close(), 1100);
      } catch (error) {
        console.error(error);
        message(form, error.message || "Could not send request. Please try again.");
      } finally { button.disabled = false; }
    });
  }

  async function loadProfiles(ids) {
    const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
    if (!uniqueIds.length) return {};
    const { data, error } = await client.from("profiles").select("id,full_name,phone").in("id", uniqueIds);
    if (error) throw error;
    return Object.fromEntries((data || []).map((profile) => [profile.id, profile]));
  }
  async function loadDoctorsByIds(ids) {
    const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
    if (!uniqueIds.length) return {};
    const { data, error } = await client.from("doctors").select("id,user_id,full_name,specialty").in("id", uniqueIds);
    if (error) throw error;
    return Object.fromEntries((data || []).map((doctor) => [doctor.id, doctor]));
  }
  function renderAppointmentCard(appointment, doctor, patient, options) {
    const card = node("article", options && options.admin ? "appointment-card" : "appointment-card");
    const head = node("div", "appointment-head");
    const info = node("div");
    const title = options && options.patientView ? (doctor && doctor.full_name || "Doctor appointment") : (patient && patient.full_name || "Patient appointment");
    addText(info, "h3", "", title);
    const date = appointment.appointment_date || appointment.available_date;
    addText(info, "p", "", formatDate(date) + " · " + String(appointment.slot_time || "").slice(0, 5));
    if (options && options.admin) addText(info, "p", "", "Doctor: " + (doctor && doctor.full_name || "Unknown"));
    if (appointment.reason) addText(info, "p", "", "Reason: " + appointment.reason);
    head.append(info, badge(appointment.status));
    card.append(head);
    const actions = node("div", "card-actions");
    if (options && options.allowCancel && ["pending", "confirmed"].includes(appointment.status)) actions.append(actionButton("Cancel appointment", "cancel-appointment", appointment.id, "button-danger"));
    if (options && options.allowDoctorActions && appointment.status === "pending") {
      actions.append(actionButton("Confirm", "confirm-appointment", appointment.id));
      actions.append(actionButton("Reject", "reject-appointment", appointment.id, "button-danger"));
    }
    if (options && options.admin) addText(card, "p", "muted", "Patient: " + (patient && patient.full_name || "Unavailable"));
    if (actions.childNodes.length) card.append(actions);
    return card;
  }
  async function getAppointments(filters) {
    let query = client.from("appointments").select("*");
    Object.keys(filters).forEach((key) => { query = query.eq(key, filters[key]); });
    const { data, error } = await query.order("appointment_date", { ascending: true });
    if (error) throw error;
    return data || [];
  }
  async function initPatientAppointments() {
    const container = $("#patient-appointments");
    if (!container) return;
    try {
      const user = await requireUser();
      const [appointments, selected] = await Promise.all([
        getAppointments({ patient_id: user.id }),
        Promise.resolve($("#appointment-filter"))
      ]);
      const doctorMap = await loadDoctorsByIds(appointments.map((item) => item.doctor_id));
      const render = () => {
        const filter = selected.value;
        const list = appointments.filter((item) => !filter || item.status === filter);
        if (!list.length) return showError(container, "No appointments match this view.");
        container.replaceChildren(...list.map((item) => renderAppointmentCard(item, doctorMap[item.doctor_id], null, { patientView: true, allowCancel: true })));
      };
      const summary = $("#appointment-summary");
      const upcoming = appointments.filter((item) => ["pending", "confirmed"].includes(item.status) && item.appointment_date >= today()).length;
      summary.replaceChildren(
        statCard(upcoming, "Upcoming"), statCard(appointments.filter((a) => a.status === "confirmed").length, "Confirmed"),
        statCard(appointments.filter((a) => a.status === "pending").length, "Pending"), statCard(appointments.filter((a) => a.status === "cancelled").length, "Cancelled")
      );
      selected.addEventListener("change", render);
      render();
      container.addEventListener("click", (event) => handleAppointmentAction(event, appointments, render, container));
    } catch (error) {
      console.error(error);
      showError(container, "Your appointments could not be loaded. Please check your account access.");
    }
  }
  function statCard(value, label) {
    const card = node("div", "stat-card");
    addText(card, "strong", "", String(value));
    addText(card, "span", "", label);
    return card;
  }
  async function handleAppointmentAction(event, appointments, render, container) {
    const button = event.target.closest("[data-action]");
    if (!button || button.dataset.action !== "cancel-appointment") return;
    const item = appointments.find((appointment) => appointment.id === button.dataset.id);
    if (!item || !["pending", "confirmed"].includes(item.status)) return;
    if (!window.confirm("Cancel this appointment request?")) return;
    button.disabled = true;
    try {
      const { error } = await client.from("appointments").update({ status: "cancelled" }).eq("id", item.id);
      if (error) throw error;
      item.status = "cancelled";
      render();
      toast("Appointment cancelled");
    } catch (error) {
      console.error(error);
      button.disabled = false;
      toast("Could not cancel appointment. Please try again.");
    }
  }

  async function initDoctorDashboard() {
    const container = $("#doctor-today");
    if (!container) return;
    try {
      const user = await requireUser();
      const doctor = await getDoctor(user.id);
      const name = $("[data-doctor-name]");
      if (name) name.textContent = ", " + (doctor.full_name || "");
      const appointments = await getAppointments({ doctor_id: doctor.id });
      const todayList = appointments.filter((item) => item.appointment_date === today());
      const patientMap = await loadProfiles(appointments.map((item) => item.patient_id));
      $("#doctor-stats").replaceChildren(
        statCard(todayList.length, "Today"), statCard(appointments.filter((a) => a.status === "pending").length, "Pending requests"),
        statCard(appointments.filter((a) => a.status === "confirmed").length, "Confirmed"), statCard(appointments.length, "All appointments")
      );
      if (!todayList.length) return showError(container, "No appointments scheduled for today.");
      container.replaceChildren(...todayList.map((item) => renderAppointmentCard(item, null, patientMap[item.patient_id], { allowDoctorActions: item.status === "pending" })));
    } catch (error) {
      console.error(error);
      showError(container, "Doctor dashboard data could not be loaded: " + (error.message || "Unknown Supabase error."));
    }
  }
  async function initDoctorRequests() {
    const container = $("#doctor-requests");
    if (!container) return;
    try {
      const user = await requireUser();
      const doctor = await getDoctor(user.id);
      const appointments = await getAppointments({ doctor_id: doctor.id });
      const patients = await loadProfiles(appointments.map((item) => item.patient_id));
      const filter = $("#doctor-request-filter");
      const render = () => {
        const list = appointments.filter((item) => !filter.value || item.status === filter.value);
        if (!list.length) return showError(container, "No requests match this status.");
        container.replaceChildren(...list.map((item) => renderAppointmentCard(item, null, patients[item.patient_id], { allowDoctorActions: true })));
      };
      filter.addEventListener("change", render);
      container.addEventListener("click", async (event) => {
        const button = event.target.closest("[data-action]");
        if (!button || !["confirm-appointment", "reject-appointment"].includes(button.dataset.action)) return;
        const target = appointments.find((item) => item.id === button.dataset.id);
        if (!target || target.status !== "pending") return;
        const status = button.dataset.action === "confirm-appointment" ? "confirmed" : "rejected";
        button.disabled = true;
        try {
          const { error } = await client.from("appointments").update({ status }).eq("id", target.id);
          if (error) throw error;
          target.status = status;
          render();
          toast("Request " + status);
        } catch (error) { console.error(error); button.disabled = false; toast("Could not update appointment."); }
      });
      render();
    } catch (error) {
      console.error(error);
      showError(container, "Appointment requests could not be loaded.");
    }
  }

  async function initAvailability() {
    const form = $("[data-availability-form]");
    const container = $("#availability-list");
    if (!form || !container) return;
    const dateInput = form.elements.namedItem("available_date");
    dateInput.min = today();
    let doctor;
    let entries = [];
    let pastEntryCount = 0;
    const render = () => {
      if (!entries.length) {
        return showError(container, pastEntryCount
          ? "Saved availability exists, but its date has passed. Add today or a future date."
          : "No future availability added yet.");
      }
      container.replaceChildren(...entries.map((entry) => {
        const card = node("article", "availability-card");
        const head = node("div", "availability-head");
        const details = node("div");
        addText(details, "h3", "", formatDate(entry.available_date));
        addText(details, "p", "", entry.start_time.slice(0, 5) + "–" + entry.end_time.slice(0, 5) + " · " + Number(entry.slot_duration || 30) + " minute slots");
        head.append(details, actionButton("Remove", "delete-availability", entry.id, "button-danger"));
        card.append(head);
        return card;
      }));
    };
    try {
      const user = await requireUser();
      doctor = await getDoctor(user.id);
      const load = async () => {
        const { data, error } = await client.from("doctor_availability").select("*").eq("doctor_id", doctor.id).order("available_date", { ascending: true });
        if (error) throw error;
        const allEntries = data || [];
        const currentDate = today();
        entries = allEntries.filter((entry) => String(entry.available_date || "").slice(0, 10) >= currentDate);
        pastEntryCount = allEntries.length - entries.length;
        render();
      };
      await load();
      container.addEventListener("click", async (event) => {
        const button = event.target.closest('[data-action="delete-availability"]');
        if (!button || !window.confirm("Remove this availability date?")) return;
        button.disabled = true;
        try {
          const { error } = await client.from("doctor_availability").delete().eq("id", button.dataset.id);
          if (error) throw error;
          entries = entries.filter((entry) => entry.id !== button.dataset.id);
          render();
          toast("Availability removed");
        } catch (error) { console.error(error); button.disabled = false; toast("Could not remove availability."); }
      });
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!form.reportValidity()) return;
        const values = readForm(form);
        if (values.end_time <= values.start_time) return message(form, "End time must be after start time.");
        const button = $("button[type=submit]", form);
        button.disabled = true;
        try {
          const { error } = await client.from("doctor_availability").insert({
            doctor_id: doctor.id,
            available_date: values.available_date,
            start_time: values.start_time,
            end_time: values.end_time,
            slot_duration: 30
          });
          if (error) throw error;
          form.reset();
          await load();
          const savedDate = String(values.available_date).slice(0, 10);
          const savedTime = String(values.start_time).slice(0, 5);
          const visible = entries.some((entry) =>
            String(entry.available_date || "").slice(0, 10) === savedDate
            && String(entry.start_time || "").slice(0, 5) === savedTime
          );
          if (visible) message(form, "Availability added.", true);
          else message(form, "Saved, but it was not visible in the list. Check the doctor ID and availability access policies.");
        } catch (error) { console.error(error); message(form, "Could not add availability. Check for duplicate dates or database permissions."); }
        finally { button.disabled = false; }
      });
    } catch (error) {
      console.error(error);
      showError(container, "Availability could not be loaded: " + (error.message || "Unknown Supabase error."));
    }
  }

  async function initDoctorProfile() {
    const form = $("[data-doctor-profile-form]");
    if (!form) return;
    try {
      const user = await requireUser();
      const doctor = await getDoctor(user.id);
      setFormValues(form, doctor);
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!form.reportValidity()) return;
        const values = readForm(form);
        const button = $("button[type=submit]", form);
        button.disabled = true;
        try {
          const { error } = await client.from("doctors").update({
            specialty: values.specialty.trim(),
            qualifications: values.qualifications.trim(),
            experience_years: Number(values.experience_years),
            consultation_fee: Number(values.consultation_fee),
            clinic_address: values.clinic_address.trim(),
            bio: values.bio.trim()
          }).eq("id", doctor.id);
          if (error) throw error;
          message(form, "Doctor profile updated.", true);
        } catch (error) { console.error(error); message(form, "Could not save your profile."); }
        finally { button.disabled = false; }
      });
    } catch (error) { console.error(error); message(form, "Doctor profile could not be loaded. Confirm your approval status."); }
  }

  async function initApplication() {
    const form = $("[data-doctor-application-form]");
    if (!form) return;
    try {
      const user = await requireUser();
      const statusBox = $("#application-status");
      const { data: existing, error } = await client.from("doctor_applications").select("*").eq("user_id", user.id).maybeSingle();
      if (error) throw error;
      const fullNameField = form.elements.namedItem("full_name");
      if (user.user_metadata && user.user_metadata.full_name) fullNameField.value = user.user_metadata.full_name;
      if (existing) {
        statusBox.hidden = false;
        statusBox.replaceChildren(node("span", "eyebrow", "APPLICATION STATUS"), node("h2", "", existing.status ? existing.status.charAt(0).toUpperCase() + existing.status.slice(1) : "Submitted"));
        if (existing.review_note) addText(statusBox, "p", "muted", existing.review_note);
        setFormValues(form, existing);
        if (!existing.full_name && existing.name) fullNameField.value = existing.name;
        if (existing.experience_years == null && existing.experience != null) {
          form.elements.namedItem("experience_years").value = existing.experience;
        }
        if (existing.status === "pending" || existing.status === "approved") form.hidden = true;
      }
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!form.reportValidity()) return;
        const values = readForm(form);
        const button = $("button[type=submit]", form);
        button.disabled = true;
        try {
          const applicantName = values.full_name.trim();
          const application = {
            user_id: user.id,
            name: applicantName,
            full_name: applicantName,
            specialty: values.specialty.trim(),
            qualifications: values.qualifications.trim(),
            experience: values.experience_years,
            experience_years: Number(values.experience_years),
            consultation_fee: Number(values.consultation_fee),
            clinic_address: values.clinic_address.trim(),
            bio: values.bio.trim(),
            status: "pending",
            review_note: null
          };
          const result = existing
            ? await client.from("doctor_applications").update(application).eq("user_id", user.id)
            : await client.from("doctor_applications").insert(application);
          if (result.error) throw result.error;
          message(form, "Application submitted for review.", true);
          toast("Application submitted");
          window.setTimeout(() => location.reload(), 850);
        } catch (error) { console.error(error); message(form, error.message || "Could not submit application."); }
        finally { button.disabled = false; }
      });
    } catch (error) { console.error(error); message(form, error.message || "Application status could not be loaded."); }
  }

  async function initAdmin() {
    const applicationsContainer = $("#admin-applications");
    const appointmentsContainer = $("#admin-appointments");
    if (!applicationsContainer || !appointmentsContainer) return;
    try {
      const user = await requireUser();
      const { data: profile, error: profileError } = await client.from("profiles").select("role").eq("id", user.id).maybeSingle();
      if (profileError) throw new Error("Could not verify admin role for account " + user.id + ": " + profileError.message);
      if (!profile || profile.role !== "admin") {
        throw new Error("Signed-in account " + user.id + " has role " + (profile && profile.role || "no profile") + "; admin role is required.");
      }
    } catch (error) {
      console.error(error);
      const details = error && error.message ? error.message : "Unknown Supabase error.";
      showError(applicationsContainer, "Admin access could not be verified: " + details);
      showError(appointmentsContainer, details);
      return;
    }

    let applications = [];
    try {
      const { data, error } = await client.from("doctor_applications").select("*").eq("status", "pending").order("created_at", { ascending: true });
      if (error) throw error;
      applications = data || [];
      if (!applications.length) showError(applicationsContainer, "There are no pending doctor applications.");
      else applicationsContainer.replaceChildren(...applications.map((application) => {
        const card = node("article", "application-card");
        const head = node("div", "request-head");
        const details = node("div");
        addText(details, "h3", "", application.full_name || application.name || "Doctor applicant");
        addText(details, "p", "", (application.specialty || "Specialty not listed") + " · " + (application.qualifications || "Qualifications not listed"));
        const experience = application.experience_years == null ? application.experience : application.experience_years;
        addText(details, "p", "", (experience || 0) + " years experience · Fee: " + (application.consultation_fee == null ? "Not set" : application.consultation_fee));
        addText(details, "p", "", application.clinic_address || "");
        if (application.bio) addText(details, "p", "", application.bio);
        head.append(details, badge(application.status));
        card.append(head);
        const actions = node("div", "card-actions");
        actions.append(actionButton("Approve", "approve-application", application.id));
        actions.append(actionButton("Reject", "reject-application", application.id, "button-danger"));
        card.append(actions);
        return card;
      }));
      applicationsContainer.addEventListener("click", async (event) => {
        const button = event.target.closest("[data-action]");
        if (!button) return;
        const application = applications.find((item) => item.id === button.dataset.id);
        if (!application) return;
        button.disabled = true;
        try {
          const status = button.dataset.action === "approve-application" ? "approved" : "rejected";
          if (status === "approved") {
            const fullName = application.full_name || application.name || "Doctor applicant";
            const experienceYears = application.experience_years == null ? application.experience : application.experience_years;
            const { error: doctorError } = await client.from("doctors").upsert({
              user_id: application.user_id,
              full_name: fullName,
              name: fullName,
              specialty: application.specialty,
              speciality: application.specialty,
              qualifications: application.qualifications,
              experience: experienceYears,
              experience_years: experienceYears,
              consultation_fee: application.consultation_fee,
              clinic_address: application.clinic_address,
              bio: application.bio,
              status: "approved"
            }, { onConflict: "user_id" });
            if (doctorError) throw doctorError;
            const { error: profileUpdateError } = await client.rpc("careconnect_set_profile_role", {
              target_profile_id: application.user_id,
              new_role: "doctor"
            });
            if (profileUpdateError) throw profileUpdateError;
          }
          const { error: updateError } = await client.from("doctor_applications").update({ status }).eq("id", application.id);
          if (updateError) throw updateError;
          applications.splice(applications.indexOf(application), 1);
          if (!applications.length) showError(applicationsContainer, "There are no pending doctor applications.");
          else button.closest(".application-card").remove();
          toast("Application " + status);
        } catch (error) {
          console.error(error);
          button.disabled = false;
          toast("Could not update application: " + (error.message || "Unknown Supabase error."));
        }
      });
    } catch (error) {
      console.error(error);
      showError(applicationsContainer, "Applications could not be loaded: " + (error.message || "Unknown Supabase error."));
    }

    try {
      const appointments = await getAppointments({});
      const profileMap = await loadProfiles(appointments.map((item) => item.patient_id));
      const doctorMap = await loadDoctorsByIds(appointments.map((item) => item.doctor_id));
      const filter = $("#admin-appointment-filter");
      const renderAppointments = () => {
        const list = appointments.filter((item) => !filter.value || item.status === filter.value);
        if (!list.length) return showError(appointmentsContainer, "No appointments match this status.");
        appointmentsContainer.replaceChildren(...list.map((item) => renderAppointmentCard(item, doctorMap[item.doctor_id], profileMap[item.patient_id], { admin: true })));
      };
      filter.addEventListener("change", renderAppointments);
      renderAppointments();
    } catch (error) {
      console.error(error);
      showError(appointmentsContainer, "Appointments could not be loaded: " + (error.message || "Unknown Supabase error."));
    }
  }

  async function initProfile() {
    const form = $("[data-profile-form]");
    if (!form) return;
    const user = window.careConnectAuth && window.careConnectAuth.user;
    const profile = window.careConnectAuth && window.careConnectAuth.profile;
    if (profile) setFormValues(form, profile);
    const preview = $("#avatar-preview");
    const fileInput = $("#avatar-file");
    if (profile && profile.avatar_url && preview) preview.src = profile.avatar_url;
    if (fileInput) fileInput.addEventListener("change", () => {
      const file = fileInput.files && fileInput.files[0];
      if (file && preview) preview.src = URL.createObjectURL(file);
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const values = readForm(form);
      const button = $("button[type=submit]", form);
      if (!validPhone(values.phone.trim())) return message(form, "Enter a valid phone number (7–20 characters).");
      button.disabled = true;
      try {
        let avatarUrl = profile && profile.avatar_url || null;
        const file = fileInput && fileInput.files && fileInput.files[0];
        if (file) {
          if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) throw new Error("Choose an image smaller than 5 MB.");
          const extension = file.name.split(".").pop().replace(/[^a-zA-Z0-9]/g, "") || "jpg";
          const path = user.id + "/" + Date.now() + "." + extension;
          const { error: uploadError } = await client.storage.from("avatars").upload(path, file, { upsert: true, contentType: file.type });
          if (uploadError) throw uploadError;
          const { data } = client.storage.from("avatars").getPublicUrl(path);
          avatarUrl = data.publicUrl;
        }
        const profileValues = {
          full_name: values.full_name.trim(),
          phone: values.phone.trim(),
          date_of_birth: values.date_of_birth || null,
          gender: values.gender || null,
          city: values.city.trim(),
          address: values.address.trim(),
          avatar_url: avatarUrl
        };
        const result = profile
          ? await client.from("profiles").update(profileValues).eq("id", user.id)
          : await client.from("profiles").insert({ id: user.id, ...profileValues });
        const { error } = result;
        if (error) throw error;
        message(form, "Profile saved successfully.", true);
        toast("Profile updated");
      } catch (error) { console.error(error); message(form, error.message || "Could not save your profile. Check your storage and database permissions."); }
      finally { button.disabled = false; }
    });
  }
  function initOnboarding() {
    const form = $("[data-onboarding-form]");
    if (!form) return;
    const user = window.careConnectAuth && window.careConnectAuth.user;
    if (user && user.user_metadata && user.user_metadata.full_name) form.elements.namedItem("full_name").value = user.user_metadata.full_name;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const values = readForm(form);
      const button = $("button[type=submit]", form);
      if (!validPhone(values.phone.trim())) return message(form, "Enter a valid phone number (7–20 characters).");
      button.disabled = true;
      try {
        const { error } = await client.rpc("careconnect_complete_profile", {
          profile_full_name: values.full_name.trim(),
          profile_phone: values.phone.trim(),
          profile_date_of_birth: values.date_of_birth,
          profile_gender: values.gender,
          profile_city: values.city.trim(),
          profile_address: values.address.trim(),
          requested_role: values.role
        });
        if (error) throw error;
        location.href = values.role === "doctor_applicant" ? "apply-doctor.html" : "index.html";
      } catch (error) { console.error(error); message(form, error.message || "Could not save your profile."); }
      finally { button.disabled = false; }
    });
  }
  function initAuthForms() {
    const tabs = $$("[data-auth-tab]");
    if (tabs.length) {
      tabs.forEach((tab) => tab.addEventListener("click", () => {
        tabs.forEach((item) => item.classList.toggle("active", item === tab));
        $$("[data-auth-form]").forEach((form) => { form.hidden = form.dataset.authForm !== tab.dataset.authTab; });
      }));
    }
    $$("[data-auth-form]").forEach((form) => form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const values = readForm(form);
      const button = $("button[type=submit]", form);
      button.disabled = true;
      try {
        let result;
        if (form.dataset.authForm === "signin") result = await client.auth.signInWithPassword({ email: values.email.trim(), password: values.password });
        else if (form.dataset.authForm === "signup") {
          result = await client.auth.signUp({ email: values.email.trim(), password: values.password, options: { data: { full_name: values.full_name.trim() }, emailRedirectTo: location.origin + location.pathname.replace(/[^/]*$/, "onboarding.html") } });
        } else {
          const redirectTo = location.origin + location.pathname.replace(/[^/]*$/, "reset-password.html");
          result = await client.auth.resetPasswordForEmail(values.email.trim(), { redirectTo });
        }
        if (result.error) throw result.error;
        if (form.dataset.authForm === "signin") {
          const next = new URLSearchParams(location.search).get("next");
          location.href = next === "doctors.html" ? next : "onboarding.html";
        }
        else if (form.dataset.authForm === "signup") {
          if (result.data && result.data.session) location.href = "onboarding.html";
          else message(form, "Check your email to confirm your account, then sign in.", true);
        } else message(form, "If an account exists for that email, a recovery link has been sent.", true);
      } catch (error) {
        console.error(error);
        message(form, error.message || "Authentication failed. Please try again.");
      } finally { button.disabled = false; }
    }));
    const resetForm = $("[data-reset-form]");
    if (resetForm) {
      resetForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!resetForm.reportValidity()) return;
        const values = readForm(resetForm);
        if (values.password !== values.confirm_password) return message(resetForm, "Passwords do not match.");
        const button = $("button[type=submit]", resetForm);
        button.disabled = true;
        try {
          const { data: { session }, error: sessionError } = await client.auth.getSession();
          if (sessionError) throw sessionError;
          if (!session) throw new Error("This recovery link is invalid or expired. Request a new one.");
          const { error } = await client.auth.updateUser({ password: values.password });
          if (error) throw error;
          message(resetForm, "Password updated. You can now sign in.", true);
          window.setTimeout(() => { location.href = "index.html"; }, 1200);
        } catch (error) { console.error(error); message(resetForm, error.message || "Could not update password."); }
        finally { button.disabled = false; }
      });
    }
  }

  async function start() {
    if (!client) {
      document.querySelectorAll(".loading").forEach((el) => { el.textContent = "Supabase is unavailable. Check your internet connection and configuration."; el.classList.add("empty-state"); });
      console.error("Supabase client missing. Check CDN access and js/config.js.");
      return;
    }
    try {
      await window.careConnectAuth.init();
    } catch (error) {
      console.error("Could not validate the current account.", error);
      toast("Could not validate your account. Reload the page or sign in again.");
    }
    initAuthForms();
    initBooking();
    initOnboarding();
    initProfile();
    await Promise.all([
      initHome(), initDoctors(), initPatientAppointments(), initDoctorDashboard(), initDoctorRequests(),
      initAvailability(), initDoctorProfile(), initApplication(), initAdmin()
    ]);
  }
  document.addEventListener("DOMContentLoaded", start);
})();
