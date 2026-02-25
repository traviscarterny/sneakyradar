// netlify/functions/update-releases.mjs
// Scheduled function — runs weekly via netlify.toml
// Triggers the main anthropic function to fetch fresh release data

export default async (req) => {
  console.log("Scheduled release update triggered at", new Date().toISOString());
  
  try {
    var siteUrl = process.env.URL || "https://www.sneakyradar.com";
    var res = await fetch(siteUrl + "/.netlify/functions/anthropic", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update_releases" })
    });
    
    var data = await res.json();
    console.log("Update result:", JSON.stringify(data).substring(0, 500));
    
    return new Response(JSON.stringify(data), { status: 200 });
  } catch(err) {
    console.error("Scheduled update error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};

export const config = {
  schedule: "0 8 * * 1"  // Every Monday at 8 AM UTC
};
