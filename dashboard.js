// Make sure this matches the password string inside your code.gs exactly
const SECRET_TOKEN = "MySuperSecretPassword123";

document.addEventListener('DOMContentLoaded', async function () {
    const startBtn = document.getElementById('startBtn');
    const scriptUrlInput = document.getElementById('scriptUrlInput');
    const status = document.getElementById('status');
    const lastRunText = document.getElementById('lastRunText');

    // --- Load saved data from Chrome Memory ---
    const storedData = await chrome.storage.local.get(['savedUrl', 'lastRunTime']);
    if (storedData.savedUrl) {
        scriptUrlInput.value = storedData.savedUrl;
    }
    if (storedData.lastRunTime) {
        lastRunText.innerText = `Last Run: ${storedData.lastRunTime}`;
    }

    // --- Auto-start feature for morning alarms ---
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('auto') === 'true') {
        if (scriptUrlInput.value.trim() !== "") {
            status.innerText = "Morning Alarm Triggered! Starting auto-scrape...";
            setTimeout(() => startBtn.click(), 1500);
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

        // --- Save the URL to Chrome Memory ---
        chrome.storage.local.set({ savedUrl: webAppUrl });

        const tabsToProcess = ['FSN', 'ASIN'];
        startBtn.disabled = true;
        startBtn.style.backgroundColor = "#ccc";

        for (const tab of tabsToProcess) {
            status.innerText = `Fetching ${tab} queue...`;

            try {
                // 1. Fetch from Google Sheets
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

                // 2. Loop and Scrape
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
                            // --- AMAZON SCRAPING LOGIC ---
                            const priceElement = doc.querySelector("span.a-offscreen, span.a-price-whole");
                            price = priceElement ? (priceElement.textContent || "").trim() : "N/A";
                        } else {
                            // --- FLIPKART SCRAPING LOGIC ---
                            let foundPrice = "N/A";
                            
                            // Tier 1: JSON-LD Strategy 
                            const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
                            for (let script of scripts) {
                                try {
                                    const jsonData = JSON.parse(script.textContent || "");
                                    const items = Array.isArray(jsonData) ? jsonData : [jsonData];
                                    for (let item of items) {
                                        if (item['@type'] === 'Product' && item.offers) {
                                            let offers = Array.isArray(item.offers) ? item.offers : [item.offers];
                                            if (offers[0] && offers[0].price) {
                                                foundPrice = String(offers[0].price);
                                                break;
                                            }
                                        }
                                    }
                                } catch (e) {}
                                if (foundPrice !== "N/A") break;
                            }

                            // Tier 2: DOM Node Search Strategy
                            if (foundPrice === "N/A") {
                                const allElements = doc.querySelectorAll('div, span');
                                for (let el of allElements) {
                                    const txt = (el.textContent || "").trim();
                                    // Looks for any text containing our messy symbol or standard ₹
                                    if (/(?:₹|&#8377;|â‚¹|Rs\.?)\s*[0-9,]+(\.[0-9]+)?/.test(txt)) {
                                        foundPrice = txt; 
                                        break; 
                                    }
                                }
                            }

                            // Tier 3: Raw Text Regex Strategy
                            if (foundPrice === "N/A") {
                                const rawMatch = text.match(/>\s*(?:₹|&#8377;|â‚¹|Rs\.?)\s*([0-9,]+(\.[0-9]+)?)\s*</);
                                if (rawMatch && rawMatch[1]) {
                                    foundPrice = rawMatch[1];
                                }
                            }

                            price = foundPrice;
                        }

                        // --- THE MASTER CLEANUP FILTER ---
                        if (price !== "N/A" && price !== "Blocked/Error") {
                            // This rips out EVERYTHING except numbers, commas, and decimals
                            const cleanNumber = price.match(/[0-9,]+(\.[0-9]+)?/);
                            
                            if (cleanNumber && cleanNumber[0]) {
                                // \u20B9 is the universal safe code for ₹
                                // If you want JUST the numbers (no symbol at all), change this to: price = cleanNumber[0];
                                price = "\u20B9 " + cleanNumber[0];
                            } else {
                                price = "N/A";
                            }
                        }

                    } catch (err) {
                        price = "Blocked/Error";
                    }

                    updates.push({ rowIndex: row.rowIndex, price: price });
                    status.innerText = `Scraping (${tab}): ${i + 1}/${rows.length} | Price: ${price}`;

                    // Safety throttle delay
                    const delay = Math.floor(Math.random() * 2000) + 1000; 
                    await new Promise(r => setTimeout(r, delay));
                }

                // 3. Write Back to Google Sheets
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

        // --- Save and display Last Run Timestamp ---
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