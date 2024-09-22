// on first install open the options page to set the API key
chrome.runtime.onInstalled.addListener(function (details) {
    if (details.reason == "install") {
        chrome.tabs.create({ url: "options.html" });
    }
});

// get the current time for context in the system message
let time = new Date().toLocaleString('en-US');

// create a system message
const systemMessage = "You are a helpful URL link-analyzer who only responds with one word (do not add periods to the end of that word). Your task is to identify the name of a company present within a given URL. Note: If you cannot determine the company or if the link does not contain a company, do not return anything (just a blank). Never return Unknown, None, or a similar version. Example input: “https://google.com”, Example output: Google";

// initialize the message array with a system message
let messageArray = [
    { role: "system", content: systemMessage }
];

// an event listener to listen for a message from the content script that says the user has opened the popup
chrome.runtime.onMessage.addListener(function (request) {
    // check if the request contains a message that the user has opened the popup
    if (request.openedPopup) {
        // reset the message array to remove the previous conversation
        messageArray = [
            { role: "system", content: systemMessage }
        ];
    }
});

// Listen for a request message from the content script
chrome.runtime.onMessage.addListener(async function (request, sender, sendResponse) {
    // Check if the request contains a message that the user sent a new message
    if (request.input) {
        // Split the input into individual URLs
        let urls = request.input.split('\n').filter(url => url.trim() !== '');
        let uniqueResponses = new Set();
        let responses = [];

        // get the API key and model from local storage
        const apiKey = await new Promise(resolve => chrome.storage.local.get(['apiKey'], result => resolve(result.apiKey)));
        const apiModel = await new Promise(resolve => chrome.storage.local.get(['apiModel'], result => resolve(result.apiModel)));

        for (let i = 0; i < urls.length; i++) {
            let query = urls[i]; // Define the query variable here
            try {
                // Send the request containing the URL to the OpenAI API
                const response = await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`
                    },
                    body: JSON.stringify({
                        "model": apiModel,
                        "messages": [
                            { role: "system", content: systemMessage },
                            { role: "user", content: query } // Use query here
                        ]
                    })
                });

                // check if the API response is ok else throw an error
                if (!response.ok) {
                    throw new Error(`Failed to fetch. Status code: ${response.status}`);
                }

                // get the data from the API response as json
                let data = await response.json();

                // check if the API response contains an answer
                if (data && data.choices && data.choices.length > 0) {
                    // get the answer from the API response
                    let answer = data.choices[0].message.content.trim();

                    // Add the response if it is unique
                    if (answer && !uniqueResponses.has(answer)) {
                        uniqueResponses.add(answer);
                        responses.push(answer);
                        chrome.runtime.sendMessage({ answer: `` });
                    }
                }
            } catch (error) {
                // send error message back to the content script
                chrome.runtime.sendMessage({ answer: "No answer received: Make sure the entered API-Key is correct." });
            }
        }

        // Prepare the second API call to remove duplicate companies
        const deduplicateSystemMessage = "You are tasked to remove duplicate companies from a list of companies. Furthermore, remove any items which are not companies, data analytics tools, and search engines but instead are applications, such as ReCaptcha and cdn, that could not be used for data tracking, collection, or analysis. Only use the information from the input provided. Note: Don't remove any search engines such as Bing. Only output the new list with ONLY the company names (no additional words or explanations).";
        const deduplicatePrompt = responses.join('\n');
        const deduplicateResponse = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                "model": apiModel,
                "messages": [
                    { role: "system", content: deduplicateSystemMessage },
                    { role: "user", content: deduplicatePrompt }
                ]
            })
        });

        // check if the API response is ok else throw an error
        if (!deduplicateResponse.ok) {
            throw new Error(`Failed to fetch. Status code: ${deduplicateResponse.status}`);
        }

        // get the data from the API response as json
        let deduplicatedData = await deduplicateResponse.json();
        let deduplicatedResponses = deduplicatedData.choices[0].message.content.trim().split('\n');
        // send the compiled responses back to the content script with the prefix
        let finalResponse = `Possible Companies Taking Data:\n${deduplicatedResponses.map((response, index) => `${index + 1}. ${response}`).join('\n')}`;
        chrome.runtime.sendMessage({ answer: finalResponse });
        
        // Save the query and answer to the queriesAnswers array and add a timestamp
        chrome.storage.local.get({ queriesAnswers: [] }, ({ queriesAnswers }) => {
            urls.forEach((query, index) => {
                let answer = deduplicatedResponses[index] || '';
                queriesAnswers.push({ query, answer, timeStamp: time });
            });
            chrome.storage.local.set({ queriesAnswers: queriesAnswers }, () => {
                console.log('Queries and answers saved successfully');
            });
        });
    }
    // return true to indicate that the message has been handled
    return true;
});

