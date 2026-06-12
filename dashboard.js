const SECRET_TOKEN = "MySuperSecretPassword123";

document.addEventListener('DOMContentLoaded', async function () {
    const startBtn = document.getElementById('startBtn');
    const scriptUrlInput = document.getElementById('scriptUrlInput');
    const status = document.getElementById('status');
    const lastRunText = document.getElementById('lastRunText');

    // --- NEW: Load saved data from Chrome Memory ---
    const storedData = await chrome.storage.local.get(['savedUrl', 'lastRunTime']);
    if (storedData.savedUrl) {
        scriptUrlInput.value = storedData.savedUrl;
    }
    if (storedData.lastRunTime) {
        lastRunText.innerText = `Last Run: ${storedData.lastRunTime}`;
    }

    // --- NEW: Auto-start feature for morning alarms ---
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('auto') === 'true') {
        if (scriptUrlInput.value.trim() !== "") {
            status.innerText = "Morning Alarm Triggered! Starting auto-scrape...";
            setTimeout(() => startBtn.click(), 1500); // 1.5s delay then auto-click
        } else {
            status.innerText = "Auto-run failed: No saved URL found.";
        }
    }

    startBtn.addEventListener('click', async () => {
        const webAppUrl = scriptUrlInput.value.trim();
        
        if (!webAppUrl || !webAppUrl.startsWith("https://script.google.com")) {
            alert("Please enter a valid Google Apps Script Web App URL!");
            return;
        }

        // --- NEW: Save the URL to Chrome Memory ---
        chrome.storage.local.set({ savedUrl: webAppUrl });

        const tabsToProcess = ['FSN', 'ASIN'];
        startBtn.disabled = true;
        startBtn.style.backgroundColor = "#ccc";

        for (const tab of tabsToProcess) {
            status.innerText = `Fetching ${tab} queue...`;

            try {
                const response = await fetch(webAppUrl, {
                    method: "POST",
                    mode: "cors",
                    headers: { "Content-Type": "text/plain" },
                    body: JSON.stringify({ token: SECRET_TOKEN, action: "read", tabName: tab })
                });
                
                const resData = await response.json();

                if (resData.status !== "success") {
                    status.innerText = `Error reading ${tab}: ${resData.message}`;
                    resetButton();
                    return;
                }

                const rows = resData.data;
                if (!rows || rows.length === 0) continue;

                const updates = [];

                for (let i = 0; i < rows.length; i++) {
                    const row = rows[i];
                    const id = tab === 'FSN' ? row.FSN : row.ASIN;
                    if (!id) continue;

                    const isAmazon = tab === 'ASIN';
                    const url = isAmazon 
                        ? `https://www.amazon.in/dp/${id}?th=1` 
                        : `https://www.flipkart.com/product/p/itme?pid=${id}`;

                    let price = "N/A";
                    try {
                        const pageResponse = await fetch(url);
                        const text = await pageResponse.text();
                        const parser = new DOMParser();
                        const doc = parser.parseFromString(text, 'text/html');

                        if (isAmazon) {
                            const priceElement = doc.querySelector("span.a-offscreen");
                            price = priceElement ? priceElement.innerText.trim() : "N/A";
                        } else {
                            const priceElement = doc.querySelector("div.v1zwn21l.v1zwn20._1psv1zeb9._1psv1ze0");
                            price = priceElement ? priceElement.innerText.trim() : "N/A";
                        }
                    } catch (err) {
                        price = "Blocked/Error";
                    }

                    updates.push({ rowIndex: row.rowIndex, price: price });
                    status.innerText = `Scraping (${tab}): ${i + 1}/${rows.length} | Price: ${price}`;

                    const delay = Math.floor(Math.random() * 2000) + 1000; 
                    await new Promise(r => setTimeout(r, delay));
                }

                if (updates.length > 0) {
                    status.innerText = `Writing prices to ${tab}...`;
                    const writeResponse = await fetch(webAppUrl, {
                        method: "POST",
                        mode: "cors",
                        headers: { "Content-Type": "text/plain" },
                        body: JSON.stringify({ token: SECRET_TOKEN, action: "write", tabName: tab, updates: updates })
                    });
                    const writeResult = await writeResponse.json();
                    
                    if (writeResult.status !== "success") {
                        status.innerText = `Failed writing to ${tab}: ${writeResult.message}`;
                        resetButton();
                        return;
                    }
                }

            } catch (error) {
                status.innerText = `Connection Failure: ${error.message}`;
                resetButton();
                return;
            }
        }

        // --- NEW: Save and display Last Run Timestamp ---
        const now = new Date().toLocaleString();
        chrome.storage.local.set({ lastRunTime: now });
        lastRunText.innerText = `Last Run: ${now}`;

        status.innerText = "Done! Cloud Sheet updated successfully.";
        resetButton();
    });

    function resetButton() {
        startBtn.disabled = false;
        startBtn.style.backgroundColor = "#fb641b";
    }
});