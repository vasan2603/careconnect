(function () {
  const protectedPages = {
    "onboarding.html": [],
    "appointments.html": [],
    "profile.html": [],
    "apply-doctor.html": [],
    "doctor-dashboard.html": ["doctor", "admin"],
    "doctor-requests.html": ["doctor", "admin"],
    "doctor-availability.html": ["doctor", "admin"],
    "doctor-profile.html": ["doctor", "admin"],
    "admin.html": ["admin"]
  };
  const file = location.pathname.split("/").pop() || "index.html";
  const supabase = window.supabaseClient;
  function isProfileComplete(profile) {
    return !!profile
      && !!profile.full_name
      && !!profile.phone
      && !!profile.date_of_birth
      && !!profile.gender
      && !!profile.city
      && !!profile.address
      && !!profile.role;
  }
  function homeForProfile(profile) {
    if (profile.role === "doctor_applicant") return "apply-doctor.html";
    if (profile.role === "doctor") return "doctor-dashboard.html";
    if (profile.role === "admin") return "admin.html";
    return "index.html";
  }
  window.careConnectAuth = {
    user: null,
    profile: null,
    async init() {
      if (!supabase) return null;
      const { data: { session }, error } = await supabase.auth.getSession();
      if (error) throw error;
      this.user = session && session.user;
      document.querySelectorAll("[data-guest-link]").forEach((el) => { el.hidden = !!this.user; });
      document.querySelectorAll("[data-auth-link],[data-logout]").forEach((el) => { el.hidden = !this.user; });
      document.querySelectorAll("[data-logout]").forEach((el) => el.addEventListener("click", async (event) => {
        event.preventDefault();
        const { error: signOutError } = await supabase.auth.signOut();
        if (signOutError) { console.error(signOutError); window.alert("Could not sign out. Please try again."); return; }
        location.href = "index.html";
      }));
      if (!this.user) {
        if (Object.prototype.hasOwnProperty.call(protectedPages, file)) location.replace("auth.html");
        return null;
      }
      const { data, error: profileError } = await supabase.from("profiles").select("*").eq("id", this.user.id).maybeSingle();
      if (profileError) throw profileError;
      this.profile = data;
      const profileComplete = isProfileComplete(data);
      if (file === "auth.html") {
        location.replace(profileComplete ? homeForProfile(data) : "onboarding.html");
        return data;
      }
      if (file === "reset-password.html") return data;
      if (!profileComplete && file !== "onboarding.html") {
        location.replace("onboarding.html");
        return data;
      }
      const allowedRoles = protectedPages[file];
      if (allowedRoles && allowedRoles.length) {
        if (!profileComplete || !allowedRoles.includes(data.role)) {
          location.replace(profileComplete ? homeForProfile(data) : "onboarding.html");
          return data;
        }
      } else if (file === "onboarding.html" && profileComplete) {
        location.replace(homeForProfile(data));
      }
      return data;
    }
  };
})();
