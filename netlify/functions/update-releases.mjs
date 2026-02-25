// netlify/functions/update-releases.mjs
// Scheduled function — runs weekly, fetches releases, commits to GitHub
// This makes releases.json a static file that persists forever until next update

export default async (req) => {
  console.log("Scheduled release update triggered at", new Date().toISOString());
  
  var GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  var ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  var REPO = "traviscarterny/sneakyradar";
  var FILE_PATH = "releases.json";
  
  if (!GITHUB_TOKEN) {
    console.error("No GITHUB_TOKEN set");
    return new Response(JSON.stringify({ error: "No GITHUB_TOKEN" }), { status: 500 });
  }
  if (!ANTHROPIC_KEY) {
    console.error("No ANTHROPIC_API_KEY set");
    return new Response(JSON.stringify({ error: "No ANTHROPIC_API_KEY" }), { status: 500 });
  }

  try {
    // Step 1: Fetch release page HTML from multiple sources
    var sources = [
      "https://justfreshkicks.com/air-jordan-sneaker-releases-2026/",
      "https://justfreshkicks.com/nike-release-dates/",
      "https://www.kickscrew.com/blogs/sneakernews/air-jordan-release-dates"
    ];
    
    var allContent = "";
    for (var si = 0; si < sources.length; si++) {
      try {
        var pageRes = await fetch(sources[si], { 
          headers: { "User-Agent": "Mozilla/5.0 (compatible; SneakyRadar/1.0)" }
        });
        var pageText = await pageRes.text();
        console.log("Fetched source " + si + ": " + sources[si].substring(0, 60) + " length:" + pageText.length);
        
        var dateIdx = pageText.indexOf("Release Date:");
        if (dateIdx === -1) dateIdx = pageText.indexOf("Release Date");
        if (dateIdx === -1) dateIdx = pageText.indexOf("release-date");
        if (dateIdx === -1) dateIdx = pageText.indexOf("2026");
        
        if (dateIdx > 0) {
          var start = Math.max(0, dateIdx - 500);
          var chunk = pageText.substring(start, start + 30000);
          chunk = chunk.replace(/<script[\s\S]*?<\/script>/gi, '');
          chunk = chunk.replace(/<style[\s\S]*?<\/style>/gi, '');
          chunk = chunk.replace(/<!\-\-[\s\S]*?\-\->/g, '');
          allContent += "\n\n--- SOURCE: " + sources[si] + " ---\n" + chunk;
          console.log("Found release content at idx:", dateIdx, "extracted:", chunk.length, "chars");
        }
      } catch(e) {
        console.log("Source " + si + " error:", e.message);
      }
    }

    if (allContent.length < 500) {
      console.log("No release content found, keeping existing file");
      return new Response(JSON.stringify({ error: "No content found" }), { status: 500 });
    }

    // Trim to fit in Claude's context
    if (allContent.length > 60000) allContent = allContent.substring(0, 60000);

    // Step 2: Have Claude parse the HTML into structured JSON
    console.log("Sending " + allContent.length + " chars to Claude for parsing...");
    var relRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8000,
        system: "You are a JSON API. Extract sneaker release data from the provided HTML. Output ONLY a valid JSON array. No markdown, no explanation, no backticks. Start with [ end with ].",
        messages: [{ 
          role: "user", 
          content: "Extract ALL sneaker releases from this HTML. For each release return: {\"name\":\"full sneaker name with colorway in quotes\",\"sku\":\"style code or TBD\",\"date\":\"YYYY-MM-DD\",\"price\":200,\"brand\":\"Jordan or Nike or Adidas or New Balance or Other\",\"color\":\"colorway description\",\"collab\":true/false}. Only include releases with dates in 2026. If a date says March 2026 but no specific day, use the 1st. Return ONLY a JSON array.\n\nHTML:\n" + allContent
        }]
      })
    });

    var relData = await relRes.json();
    if (!relRes.ok) {
      console.log("Anthropic parse error:", JSON.stringify(relData).substring(0, 500));
      return new Response(JSON.stringify({ error: "Anthropic API error" }), { status: 500 });
    }
    
    var relText = "";
    if (relData.content) {
      for (var ri = 0; ri < relData.content.length; ri++) {
        if (relData.content[ri].type === "text") relText += relData.content[ri].text;
      }
    }
    console.log("Parse response length:", relText.length);

    // Parse JSON from response
    var parsed = null;
    try { parsed = JSON.parse(relText.trim()); } catch(e) {}
    if (!parsed) { var rm = relText.match(/\[[\s\S]*\]/); if (rm) try { parsed = JSON.parse(rm[0]); } catch(e) {} }
    if (!parsed) { var fm = relText.match(/```(?:json)?\s*([\s\S]*?)```/); if (fm) try { parsed = JSON.parse(fm[1].trim()); } catch(e) {} }
    
    if (!parsed || !Array.isArray(parsed) || parsed.length < 5) {
      console.log("Failed to parse releases or too few:", relText.substring(0, 500));
      return new Response(JSON.stringify({ error: "Parse failed, got " + (parsed ? parsed.length : 0) + " releases" }), { status: 500 });
    }

    // Clean and validate
    var cleaned = parsed.filter(function(r) {
      return r.name && r.date && r.date.match(/^\d{4}-\d{2}-\d{2}$/);
    }).map(function(r) {
      return {
        name: String(r.name || "").substring(0, 200),
        sku: String(r.sku || "TBD").substring(0, 30),
        date: r.date,
        price: Number(r.price) || 0,
        brand: String(r.brand || "Other").substring(0, 20),
        color: String(r.color || "").substring(0, 100),
        collab: Boolean(r.collab)
      };
    });

    console.log("Parsed " + cleaned.length + " releases");
    if (cleaned.length < 5) {
      console.log("Too few releases after cleaning, aborting");
      return new Response(JSON.stringify({ error: "Only " + cleaned.length + " valid releases" }), { status: 500 });
    }

    // Step 3: Build the JSON file content
    var fileContent = JSON.stringify({
      updated: new Date().toISOString(),
      source: "auto",
      count: cleaned.length,
      releases: cleaned
    }, null, 2);

    console.log("Committing " + cleaned.length + " releases to GitHub...");

    // Step 4: Check if file already exists (need its SHA to update)
    var existingSha = null;
    try {
      var getRes = await fetch("https://api.github.com/repos/" + REPO + "/contents/" + FILE_PATH, {
        headers: {
          "Authorization": "token " + GITHUB_TOKEN,
          "Accept": "application/vnd.github.v3+json",
          "User-Agent": "SneakyRadar-Bot"
        }
      });
      if (getRes.ok) {
        var getBody = await getRes.json();
        existingSha = getBody.sha;
        console.log("Existing file SHA:", existingSha);
      } else {
        console.log("File doesn't exist yet, will create new");
      }
    } catch(e) {
      console.log("Error checking existing file:", e.message);
    }

    // Step 5: Commit the file to GitHub
    var commitBody = {
      message: "Auto-update releases: " + cleaned.length + " sneakers (" + new Date().toISOString().split("T")[0] + ")",
      content: btoa(unescape(encodeURIComponent(fileContent))),
      branch: "main"
    };
    if (existingSha) commitBody.sha = existingSha;

    var commitRes = await fetch("https://api.github.com/repos/" + REPO + "/contents/" + FILE_PATH, {
      method: "PUT",
      headers: {
        "Authorization": "token " + GITHUB_TOKEN,
        "Accept": "application/vnd.github.v3+json",
        "Content-Type": "application/json",
        "User-Agent": "SneakyRadar-Bot"
      },
      body: JSON.stringify(commitBody)
    });

    var commitData = await commitRes.json();
    if (!commitRes.ok) {
      console.log("GitHub commit error:", JSON.stringify(commitData).substring(0, 500));
      return new Response(JSON.stringify({ error: "GitHub commit failed", details: commitData.message }), { status: 500 });
    }

    console.log("Successfully committed releases.json! SHA:", commitData.content.sha);
    console.log("Netlify will auto-deploy the updated file.");

    return new Response(JSON.stringify({ 
      success: true, 
      count: cleaned.length, 
      updated: new Date().toISOString(),
      sha: commitData.content.sha
    }), { status: 200 });

  } catch(err) {
    console.error("Scheduled update error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};

export const config = {
  schedule: "0 8 * * 1"  // Every Monday at 8 AM UTC
};
