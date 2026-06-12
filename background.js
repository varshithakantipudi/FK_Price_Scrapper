// Open dashboard manually when icon is clicked
chrome.action.onClicked.addListener(() => {
    chrome.tabs.create({ url: "dashboard.html" });
});

// Setup the daily 8:00 AM alarm when the extension is installed/reloaded
chrome.runtime.onInstalled.addListener(() => {
    const now = new Date();
    const nextMorning = new Date(now);
    
    // Set time to exactly 12:00 PM
    nextMorning.setHours(12, 0, 0, 0); 
    
    // If it's already past 8 AM today, set it for 8 AM tomorrow
    if (now.getTime() >= nextMorning.getTime()) {
        nextMorning.setDate(nextMorning.getDate() + 1);
    }
    
    const delayInMinutes = (nextMorning.getTime() - now.getTime()) / 60000;

    // Create the alarm to fire at the delay, and repeat every 24 hours (1440 mins)
    chrome.alarms.create("dailyMorningScrape", {
        delayInMinutes: delayInMinutes,
        periodInMinutes: 1440 
    });
});

// Listen for the alarm to go off
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "dailyMorningScrape") {
        // active: false opens it quietly in the background so it doesn't interrupt you!
        chrome.tabs.create({ url: "dashboard.html?auto=true", active: false });
    }
});