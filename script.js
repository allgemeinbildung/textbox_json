// script.js - v22 (Adapted for Questions with Solutions in Array)
(function() {
    'use strict';

    // --- CONFIGURATION & STATE---
    const STORAGE_PREFIX = 'textbox-assignment_';
    const SUB_STORAGE_PREFIX = 'textbox-sub_';
    const QUESTIONS_PREFIX = 'textbox-questions_'; // Used for storing fetched questions in localStorage
    // IMPORTANT: This URL is for assignment submission.
    const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbze5K91wdQtilTZLU8IW1iRIrXnAhlhf4kLn4xq0IKXIS7BCYN5H3YZlz32NYhqgtcLSA/exec';
    const DB_NAME = 'allgemeinbildungDB';
    const ATTACHMENT_STORE = 'attachments';
    let quill; // Globaler Zustand für den Editor
    let db; // Globaler Zustand für die IndexedDB-Verbindung

    // Speichert die aktuell geladenen Daten der Aufgabe und Unteraufgabe
    let currentAssignmentData = {
        assignmentId: null,
        subId: null,
        questions: [], // Fragen für die aktuelle subId, jetzt als Array von Objekten
        assignmentTitle: null // Titel der gesamten Aufgabe (z.B. "Versicherungswesen")
    };

    // --- Step 1.1: Set up the IndexedDB Database ---
    function initializeDB() {
        const request = indexedDB.open(DB_NAME, 1);

        request.onupgradeneeded = function(event) {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(ATTACHMENT_STORE)) {
                const attachmentStore = db.createObjectStore(ATTACHMENT_STORE, { keyPath: 'id', autoIncrement: true });
                // Index für effizientes Abrufen nach assignmentId und subId
                attachmentStore.createIndex('assignment_sub_idx', ['assignmentId', 'subId'], { unique: false });
            }
        };

        request.onsuccess = function(event) {
            db = event.target.result;
            console.log("Database initialized successfully.");
            // Laden und Anzeigen der Anhänge erfolgt nach dem Laden der Aufgabe
            // loadAndDisplayAttachments();
        };

        request.onerror = function(event) {
            console.error("IndexedDB error:", event.target.errorCode);
        };
    }

    // --- IndexedDB HELPER FUNCTIONS ---
    function saveAttachment(attachment) {
        if (!db) return;
        const transaction = db.transaction([ATTACHMENT_STORE], 'readwrite');
        const store = transaction.objectStore(ATTACHMENT_STORE);
        const request = store.add(attachment);
        request.onsuccess = () => { console.log('Attachment saved.'); loadAndDisplayAttachments(); };
        request.onerror = (e) => console.error('Error saving attachment:', e.target.error);
    }

    function getAttachments(assignmentId, subId, callback) {
        if (!db) return;
        const transaction = db.transaction([ATTACHMENT_STORE], 'readonly');
        const store = transaction.objectStore(ATTACHMENT_STORE);
        const index = store.index('assignment_sub_idx');
        const request = index.getAll([assignmentId, subId]); // Abrufen nach beiden IDs
        request.onsuccess = () => callback(request.result);
        request.onerror = (e) => console.error('Error fetching attachments:', e.target.error);
    }

    function deleteAttachment(id) {
        if (!db) return;
        const transaction = db.transaction([ATTACHMENT_STORE], 'readwrite');
        const store = transaction.objectStore(ATTACHMENT_STORE);
        const request = store.delete(id);
        request.onsuccess = () => { console.log('Attachment deleted.'); loadAndDisplayAttachments(); };
        request.onerror = (e) => console.error('Error deleting attachment:', e.target.error);
    }

    function getAllAttachmentsForAssignment(assignmentId, callback) {
        if (!db) return callback([]);
        const transaction = db.transaction([ATTACHMENT_STORE], 'readonly');
        const store = transaction.objectStore(ATTACHMENT_STORE);
        const request = store.getAll(); // Alle Anhänge abrufen
        request.onsuccess = function() {
            // Filtern der Anhänge nach der gegebenen assignmentId
            const filtered = (request.result || []).filter(att => att.assignmentId === assignmentId);
            callback(filtered);
        };
        request.onerror = function(event) {
            console.error('Error fetching all attachments:', event.target.error);
            callback([]);
        };
    }

    // --- HELPER FUNCTIONS ---
    function debounce(func, wait) { let timeout; return function(...args) { clearTimeout(timeout); timeout = setTimeout(() => func.apply(this, args), wait); }; }
    const getQueryParams = () => new URLSearchParams(window.location.search);
    const parseMarkdown = (text) => { if (!text) return ''; text = text.replace(/(\*\*|__)(?=\S)(.*?)(?<=\S)\1/g, '<strong>$2</strong>'); text = text.replace(/(\*|_)(?=\S)(.*?)(?<=\S)\1/g, '<em>$2</em>'); return text; };
    function showSaveIndicator() { const i = document.getElementById('saveIndicator'); if (!i) return; i.style.opacity = '1'; setTimeout(() => { i.style.opacity = '0'; }, 2000); }
    
    function showPasteError() {
        const notification = document.getElementById('paste-error-notification');
        if (notification) {
            if (notification.style.display === 'block') return; // Nachricht nicht stapeln
            notification.style.display = 'block';
            setTimeout(() => {
                notification.style.display = 'none';
            }, 3000); // Nach 3 Sekunden ausblenden
        }
    }

    async function createSha256Hash(str) { const b = new TextEncoder().encode(str); const h = await crypto.subtle.digest('SHA-256', b); return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join(''); }
    function getCanonicalJSONString(data) { if (data === null || typeof data !== 'object') return JSON.stringify(data); if (Array.isArray(data)) return `[${data.map(getCanonicalJSONString).join(',')}]`; const k = Object.keys(data).sort(); const p = k.map(key => `${JSON.stringify(key)}:${getCanonicalJSONString(data[key])}`); return `{${p.join(',')}}`; }

    // --- DATA SAVING & LOADING ---
    function saveContent() {
        // Sicherstellen, dass assignmentId und subId geladen sind
        if (!quill || !currentAssignmentData.assignmentId || !currentAssignmentData.subId) return;
        const htmlContent = quill.root.innerHTML;
        if (htmlContent === '<p><br></p>' || htmlContent === '') return;
        localStorage.setItem(`${STORAGE_PREFIX}${currentAssignmentData.assignmentId}_${SUB_STORAGE_PREFIX}${currentAssignmentData.subId}`, htmlContent);
        showSaveIndicator();
    }
    const debouncedSave = debounce(saveContent, 1500);

    function loadContent() {
        // Sicherstellen, dass assignmentId und subId geladen sind
        if (!quill || !currentAssignmentData.assignmentId || !currentAssignmentData.subId) return;
        const savedText = localStorage.getItem(`${STORAGE_PREFIX}${currentAssignmentData.assignmentId}_${SUB_STORAGE_PREFIX}${currentAssignmentData.subId}`);
        if (savedText) { quill.root.innerHTML = savedText; }
    }

    // --- FOCUSED DATA GATHERING LOGIC (FOR PRINT/BACKUP) ---
    async function gatherCurrentAssignmentData(promptForIdentifier = true) {
        // Verwende die globalen Daten der aktuell geladenen Aufgabe
        const assignmentId = currentAssignmentData.assignmentId;
        const subId = currentAssignmentData.subId;
        // Fragen sind jetzt ein Array von Objekten, extrahiere nur den Text für den Export
        const questionsForExport = {};
        currentAssignmentData.questions.forEach((q, index) => {
            questionsForExport[`question${index + 1}`] = q.question_text;
        });

        if (!assignmentId || !subId) {
            alert("Fehler: Aktuelle 'assignmentId' oder 'subId' nicht geladen. Aktion nicht möglich.");
            return null;
        }

        let identifier = localStorage.getItem('aburossi_exporter_identifier') || '';
        if (promptForIdentifier) {
            identifier = prompt('Bitte gib deinen Namen oder eine eindeutige Kennung für diese Aktion ein:', identifier);
            if (!identifier) {
                alert('Aktion abgebrochen. Eine Kennung ist erforderlich.');
                return null;
            }
            localStorage.setItem('aburossi_exporter_identifier', identifier);
        }

        // Aufbau des Payloads für eine einzelne assignmentId/subId wie vom Verifier erwartet
        // { "assignmentId": { "subId": { answer: "...", questions: {}, attachments: [] } } }
        const payload = { [assignmentId]: {} };
        payload[assignmentId][subId] = {};

        // Antwort aus dem Quill-Editor (oder localStorage, falls noch nicht gespeichert)
        payload[assignmentId][subId].answer = quill.root.innerHTML;
        if (payload[assignmentId][subId].answer.trim() === '<p><br></p>') {
            // Wenn der Editor leer ist, versuchen, aus dem localStorage zu laden
            const savedAnswer = localStorage.getItem(`${STORAGE_PREFIX}${assignmentId}_${SUB_STORAGE_PREFIX}${subId}`);
            if (savedAnswer && savedAnswer.trim() !== '<p><br></p>') {
                payload[assignmentId][subId].answer = savedAnswer;
            } else {
                payload[assignmentId][subId].answer = ""; // Sicherstellen, dass es ein leerer String ist, wenn keine Antwort vorhanden ist
            }
        }
        
        // Fragen für den Export verwenden
        payload[assignmentId][subId].questions = questionsForExport;
        
        // Anhänge für die aktuelle subId abrufen
        const attachments = await new Promise(resolve => getAttachments(assignmentId, subId, resolve));
        if (attachments && attachments.length > 0) {
            payload[assignmentId][subId].attachments = attachments.map(att => ({
                fileName: att.fileName,
                fileType: att.fileType,
                data: att.data
            }));
        }

        if (Object.keys(payload[assignmentId]).length === 0 || Object.keys(payload[assignmentId][subId]).length === 0) {
            alert("Für diese Aufgabe wurden keine Daten zum Verarbeiten gefunden.");
            return null;
        }

        let signature = null;
        if (window.crypto && window.crypto.subtle) {
            try {
                signature = await createSha256Hash(getCanonicalJSONString(payload));
            } catch (e) { console.error("Error creating signature:", e); }
        }

        return { identifier, assignmentId, payload, signature, createdAt: new Date().toISOString() };
    }

    // --- COMPREHENSIVE DATA GATHERING LOGIC (FOR SUBMIT ALL) ---
    async function gatherAllAssignmentsData(promptForIdentifier = true) {
        // Die aktuelle Editor-Antwort speichern, falls noch nicht geschehen
        saveContent();

        let identifier = localStorage.getItem('aburossi_exporter_identifier') || '';
        if (promptForIdentifier) {
            identifier = prompt('Bitte gib deinen Namen oder eine eindeutige Kennung für diese Abgabe ein:', identifier);
            if (!identifier) {
                alert('Aktion abgebrochen. Eine Kennung ist erforderlich.');
                return null;
            }
            localStorage.setItem('aburossi_exporter_identifier', identifier);
        }

        const allDataPayload = {};
        const answerRegex = new RegExp(`^${STORAGE_PREFIX}(.+)_${SUB_STORAGE_PREFIX}(.+)$`);
        const questionRegex = new RegExp(`^${QUESTIONS_PREFIX}(.+)_${SUB_STORAGE_PREFIX}(.+)$`);

        // Alle Antworten aus dem localStorage sammeln
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            const answerMatch = key.match(answerRegex);
            if (answerMatch) {
                const [, assignmentId, subId] = answerMatch;
                if (!allDataPayload[assignmentId]) allDataPayload[assignmentId] = {};
                if (!allDataPayload[assignmentId][subId]) allDataPayload[assignmentId][subId] = {};
                allDataPayload[assignmentId][subId].answer = localStorage.getItem(key);
            }
        }

        // Alle Fragen aus dem localStorage sammeln
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            const questionMatch = key.match(questionRegex);
            if (questionMatch) {
                const [, assignmentId, subId] = questionMatch;
                if (!allDataPayload[assignmentId]) allDataPayload[assignmentId] = {};
                if (!allDataPayload[assignmentId][subId]) allDataPayload[assignmentId][subId] = {};
                // Hier wird JSON.parse() verwendet, um das Fragenobjekt aus dem localStorage zu holen.
                // Es wird angenommen, dass dies bereits das { "question1": "text", ... } Format ist,
                // das von `loadAssignmentAndQuestions` in localStorage gespeichert wurde.
                try {
                    allDataPayload[assignmentId][subId].questions = JSON.parse(localStorage.getItem(key));
                } catch (e) { console.error(`Error parsing questions for key ${key}`, e); }
            }
        }
        
        // Alle Anhänge aus IndexedDB sammeln
        const allAttachments = await new Promise(resolve => {
            if (!db) { resolve([]); return; }
            const transaction = db.transaction([ATTACHMENT_STORE], 'readonly');
            const store = transaction.objectStore(ATTACHMENT_STORE);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = (e) => { console.error("Error fetching all attachments:", e.target.error); resolve([]); };
        });
        
        allAttachments.forEach(att => {
            if (allDataPayload[att.assignmentId] && allDataPayload[att.assignmentId][att.subId]) {
                if (!allDataPayload[att.assignmentId][att.subId].attachments) {
                    allDataPayload[att.assignmentId][att.subId].attachments = [];
                }
                allDataPayload[att.assignmentId][att.subId].attachments.push({ fileName: att.fileName, fileType: att.fileType, data: att.data });
            }
        });

        if (Object.keys(allDataPayload).length === 0) {
            alert("Es wurden keine gespeicherten Aufträge zum Senden gefunden.");
            return null;
        }

        let signature = null;
        if (window.crypto && window.crypto.subtle) {
            try {
                signature = await createSha256Hash(getCanonicalJSONString(allDataPayload));
            } catch (e) { console.error("Error creating signature:", e); }
        }

        return { identifier, payload: allDataPayload, signature, createdAt: new Date().toISOString() };
    }

    // --- SUBMISSION FUNCTION ---
    async function submitAssignment() {
        console.log("Starting submission process for ALL assignments...");
        const finalObject = await gatherAllAssignmentsData(true); // Ruft alle Daten ab, einschließlich der aktuellen Editor-Inhalte
        if (!finalObject) return;

        if (!GOOGLE_SCRIPT_URL) {
            alert('Konfigurationsfehler: Die Abgabe-URL ist nicht festgelegt. Bitte kontaktiere deinen Lehrer.');
            return;
        }
        const confirmation = confirm("Du bist dabei, ALLE gespeicherten Aufträge an deinen Lehrer zu senden. Fortfahren?");
        if (!confirmation) {
            alert("Abgabe abgebrochen.");
            return;
        }
        alert('Deine Arbeiten werden an Google Drive übermittelt. Dies kann einen Moment dauern. Bitte warte auf die Erfolgsbestätigung.');
        try {
            const response = await fetch(GOOGLE_SCRIPT_URL, { method: 'POST', mode: 'cors', body: JSON.stringify(finalObject) });
            const result = await response.json();
            if (response.ok && result.status === 'success') {
                const successMessage = `Deine Arbeiten wurden erfolgreich übermittelt.\n\nDu kannst alle deine Abgaben in diesem Ordner einsehen:\n${result.folderUrl}`;
                alert(successMessage);
            }
            else {
                throw new Error(result.message || 'Ein unbekannter Fehler ist auf dem Server aufgetreten.');
            }
        } catch (error) {
            console.error('Google Drive submission failed:', error);
            alert(`Fehler beim Senden der Daten an Google Drive. Dies könnte ein Internetproblem sein.\n\nBitte versuche es erneut.\n\nFehler: ${error.message}`);
        }
    }

    // --- PRINT FUNCTION ---
    async function printAssignment() {
        const data = await gatherCurrentAssignmentData(false); // Ruft die Daten der aktuellen Aufgabe ab, ohne nach ID zu fragen
        if (!data || !data.payload) return;
        
        const assignmentId = data.assignmentId; // Der assignmentId aus den geladenen Daten
        const assignmentData = data.payload[assignmentId]; // Zugriff auf die Struktur, die gatherCurrentAssignmentData zurückgibt

        if (!assignmentData) {
            alert("Keine Daten für die aktuelle Aufgabe zum Drucken gefunden.");
            return;
        }

        const assignmentSuffix = currentAssignmentData.assignmentTitle || assignmentId; // Titel oder ID
        const subId = currentAssignmentData.subId; // Die aktuelle subId

        let allContent = `<h2>${assignmentSuffix}</h2>`;

        // Da wir nur die aktuell geladene subId drucken wollen:
        const subData = assignmentData[subId];
        if (subData) {
            const answerContent = subData.answer;
            const questions = subData.questions; // Dies ist jetzt das { "question1": "text", ... } Objekt

            let questionsHtml = '';
            if (questions && Object.keys(questions).length > 0) {
                const sortedKeys = Object.keys(questions).sort((a, b) => (parseInt(a.replace('question', ''), 10) - parseInt(b.replace('question', ''), 10)));
                questionsHtml = '<div class="questions-print"><ol>';
                sortedKeys.forEach(qKey => { questionsHtml += `<li>${parseMarkdown(questions[qKey])}</li>`; });
                questionsHtml += '</ol></div>';
            }
            // Für Einzeldruck keine "new-page" Klasse hinzufügen
            const blockClass = 'sub-assignment-block';
            allContent += `<div class="${blockClass}">`;
            allContent += `<h3>Thema: ${subId}</h3>`; // Verwende die subId als Thema
            if (questionsHtml) allContent += questionsHtml;
            allContent += `<div class="lined-content">${answerContent || '<p><em>Keine Antwort vorhanden.</em></p>'}</div>`;
            allContent += `</div>`;
        } else {
            alert("Die Daten für die aktuelle Unteraufgabe konnten nicht zum Drucken gefunden werden.");
            return;
        }
        
        printFormattedContent(allContent, `Druckansicht: ${assignmentSuffix} - ${subId}`);
    }

    function printFormattedContent(content, printWindowTitle = 'Druckansicht') {
        const printWindow = window.open('', '', 'height=800,width=800');
        if (!printWindow) { alert("Bitte erlaube Pop-up-Fenster, um drucken zu können."); return; }
        const lineHeight = '1.4em';
        const lineColor = '#d2d2d2';
        printWindow.document.write(`<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><title>${printWindowTitle}</title><style>body{font-family:Arial,sans-serif;color:#333;line-height:${lineHeight};padding:${lineHeight};margin:0;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}@page{size:A4;margin:1cm}.lined-content{background-color:#fdfdfa;position:relative;min-height:calc(22 * ${lineHeight});height:auto;overflow:visible;background-image:repeating-linear-gradient(to bottom,transparent 0,transparent calc(${lineHeight} - 1px),${lineColor} calc(${lineHeight} - 1px),${lineColor} ${lineHeight});background-size:100% ${lineHeight};background-position:0 0;background-repeat:repeat-y}h1,h2,h3,p,li,div,.questions-print,.sub-assignment-block{line-height:inherit;background-color:transparent!important;margin-top:0;margin-bottom:0}h2{color:#003f5c;margin-bottom:${lineHeight}}h3{color:#2f4b7c;margin-top:${lineHeight};margin-bottom:${lineHeight};page-break-after:avoid}ul,ol{margin-top:0;margin-bottom:${lineHeight};padding-left:2em}.questions-print ol{margin-bottom:${lineHeight};padding-left:1.5em}.questions-print li{margin-bottom:.25em}.sub-assignment-block{margin-bottom:${lineHeight};padding-top:.1px}@media print{.sub-assignment-block{page-break-after:always}.sub-assignment-block:last-child{page-break-after:auto}}</style></head><body>${content}</body></html>`);
        printWindow.document.close();
        printWindow.onload = () => { setTimeout(() => { printWindow.focus(); printWindow.print(); }, 500); };
    }

    // --- LOCAL RESTORE FUNCTIONALITY ---
    async function importLocalBackup(event) {
        const file = event.target.files[0];
        const importFileInput = document.getElementById('importFileInput');
        if (!file) return;

        if (!file.name.endsWith('.json')) {
            alert("Ungültiger Dateityp. Bitte eine .json Backup-Datei auswählen.");
            if (importFileInput) importFileInput.value = '';
            return;
        }

        if (!confirm("WARNUNG: Das Einspielen eines Backups löscht ALLE aktuell in diesem Kontext (z.B. Obsidian) gespeicherten Daten und ersetzt sie. Fortfahren?")) {
            if (importFileInput) importFileInput.value = '';
            return;
        }

        try {
            const jsonContent = await file.text();
            const importedData = JSON.parse(jsonContent);
            const dataToRestore = importedData.payload || importedData; // Handhabt sowohl direkten Payload als auch gewickelte Struktur

            if (typeof dataToRestore !== 'object' || dataToRestore === null) {
                throw new Error("Die JSON-Datei hat nicht das erwartete Format.");
            }

            await restoreDataFromStoreObject(dataToRestore);
        } catch (error) {
            console.error("Import-Fehler:", error);
            alert(`Ein Fehler ist beim Einspielen des Backups aufgetreten. Die Datei ist möglicherweise beschädigt oder hat ein falsches Format.\n\nFehler: ${error.message}`);
        } finally {
            if (importFileInput) importFileInput.value = '';
        }
    }

    async function restoreDataFromStoreObject(dataStore) {
        await clearAllData(true); // Bestehende Daten stillschweigend löschen

        // Löschen bestehender Anhänge aus IndexedDB, bevor neue hinzugefügt werden
        const dbClearTransaction = db.transaction([ATTACHMENT_STORE], 'readwrite');
        const dbClearStore = dbClearTransaction.objectStore(ATTACHMENT_STORE);
        dbClearStore.clear();

        return new Promise((resolve, reject) => {
            dbClearTransaction.oncomplete = async () => { // Warten, bis das Löschen abgeschlossen ist
                const transaction = db.transaction([ATTACHMENT_STORE], 'readwrite');
                const store = transaction.objectStore(ATTACHMENT_STORE);

                for (const assignmentId in dataStore) {
                    for (const subId in dataStore[assignmentId]) {
                        const subData = dataStore[assignmentId][subId];
                        if (subData.answer) localStorage.setItem(`${STORAGE_PREFIX}${assignmentId}_${SUB_STORAGE_PREFIX}${subId}`, subData.answer);
                        // Beim Wiederherstellen, wenn Fragen als Objekt im Backup sind (was der Fall sein wird),
                        // speichern wir sie auch als Objekt in localStorage.
                        if (subData.questions && Object.keys(subData.questions).length > 0) localStorage.setItem(`${QUESTIONS_PREFIX}${assignmentId}_${SUB_STORAGE_PREFIX}${subId}`, JSON.stringify(subData.questions));
                        if (subData.attachments) {
                            for (const att of subData.attachments) {
                                // assignmentId und subId zu Anhängen hinzufügen
                                // um die korrekte Indizierung beim späteren Abrufen zu gewährleisten.
                                // Annahme: attachment-Objekt enthält fileName, fileType, data
                                store.add({ ...att, assignmentId: assignmentId, subId: subId });
                            }
                        }
                    }
                }

                transaction.oncomplete = () => {
                    alert("Backup erfolgreich wiederhergestellt! Die Seite wird neu geladen, um die Änderungen anzuzeigen.");
                    window.location.reload();
                    resolve();
                };
                transaction.onerror = (e) => {
                    console.error("Fehler bei der Wiederherstellung der Anhänge:", e.target.error);
                    alert("Die Wiederherstellung ist fehlgeschlagen. Fehler beim Schreiben in die Datenbank.");
                    reject(e.target.error);
                };
            };
            dbClearTransaction.onerror = (e) => {
                console.error("Fehler beim Leeren der Anhänge-Datenbank vor der Wiederherstellung:", e.target.error);
                alert("Fehler beim Vorbereiten der Datenbank für die Wiederherstellung.");
                reject(e.target.error);
            };
        });
    }

    async function clearAllData(silent = false) {
        if (!silent) {
            if (!confirm("Bist du absolut sicher, dass du ALLE gespeicherten Arbeiten und Anhänge in diesem Kontext löschen möchtest? Diese Aktion kann nicht rückgängig gemacht werden.")) return;
            if (!confirm("Letzte Warnung: Wirklich ALLE Daten löschen?")) return;
        }
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith('textbox-')) keysToRemove.push(key);
        }
        keysToRemove.forEach(key => localStorage.removeItem(key));
        return new Promise((resolve, reject) => {
            if (!db) {
                if (!silent) alert("Alle Textantworten wurden gelöscht. Die Datenbank für Anhänge war nicht erreichbar.");
                resolve();
                return;
            }
            const transaction = db.transaction([ATTACHMENT_STORE], 'readwrite');
            const store = transaction.objectStore(ATTACHMENT_STORE);
            const request = store.clear();
            request.onsuccess = () => { if (!silent) alert("Alle Daten wurden erfolgreich gelöscht."); resolve(); };
            request.onerror = (e) => { if (!silent) alert("Fehler beim Löschen der Anhänge."); reject(e.target.error); };
        });
    }

    // --- ATTACHMENT & QUESTION LOGIC ---
    function loadAndDisplayAttachments() {
        // Nutze die globalen IDs der aktuell geladenen Aufgabe
        if (!currentAssignmentData.assignmentId || !currentAssignmentData.subId) return;
        getAttachments(currentAssignmentData.assignmentId, currentAssignmentData.subId, (attachments) => {
            const container = document.getElementById('current-attachments');
            if (!container) return;
            container.innerHTML = '';
            if (attachments.length === 0) {
                container.innerHTML = '<p>Keine Dateien angehängt.</p>';
            } else {
                attachments.forEach(file => {
                    const item = document.createElement('div');
                    item.className = 'attachment-item';
                    item.innerHTML = `<span>${file.fileName}</span><button class="remove-attachment-btn" data-id="${file.id}">Entfernen</button>`;
                    container.appendChild(item);
                });
            }
        });
    }

    /**
     * Lädt die Aufgaben- und Fragedaten aus einer JSON-Datei basierend auf den URL-Parametern
     * und zeigt sie an.
     */
    async function loadAssignmentAndQuestions() {
        const params = getQueryParams();
        const assignmentIdFromUrl = params.get('assignmentId');
        const subIdFromUrl = params.get('subId');

        if (!assignmentIdFromUrl || !subIdFromUrl) {
            document.getElementById('subIdInfo').innerHTML = "<h4>Fehler: 'assignmentId' und 'subId' Parameter in der URL sind erforderlich (z.B. ?assignmentId=4.1 Versicherungswesen allgemein&subId=Das Solidaritätsprinzip erklären).</h4>";
            return;
        }

        // Erstelle den Dateinamen aus der assignmentId (Leerzeichen durch Unterstriche ersetzen)
        const jsonFileName = assignmentIdFromUrl.replace(/ /g, '_') + '.json';
        const jsonPath = `assignments/${jsonFileName}`; // Pfad zu deiner JSON-Aufgabendatei

        try {
            const response = await fetch(jsonPath);
            if (!response.ok) {
                throw new Error(`Fehler beim Laden der Aufgaben-Datei (${jsonPath}): ${response.statusText}`);
            }
            const data = await response.json();

            if (!data.assignmentId || !data.subAssignments || !data.subAssignments[subIdFromUrl]) {
                throw new Error("Die JSON-Datei hat nicht das erwartete Format oder die angegebene 'subId' existiert nicht im 'subAssignments'-Abschnitt.");
            }

            const specificSubAssignment = data.subAssignments[subIdFromUrl];
            if (!specificSubAssignment.questions || !Array.isArray(specificSubAssignment.questions)) {
                throw new Error("Die angegebene 'subId' enthält keine gültigen Fragen als Array.");
            }

            // Speichere die geladenen Daten global
            currentAssignmentData = {
                assignmentId: data.assignmentId,
                subId: subIdFromUrl,
                questions: specificSubAssignment.questions, // Fragen sind jetzt ein Array von Objekten
                assignmentTitle: data.title || data.assignmentId
            };

            // Fragen für localStorage im alten Schlüssel-Wert-Format vorbereiten,
            // da verifier.html dies erwartet und Lösungen nicht dort gespeichert werden sollen.
            const questionsForLocalStorage = {};
            currentAssignmentData.questions.forEach((q, index) => {
                questionsForLocalStorage[`question${index + 1}`] = q.question_text;
            });
            localStorage.setItem(`${QUESTIONS_PREFIX}${currentAssignmentData.assignmentId}_${SUB_STORAGE_PREFIX}${currentAssignmentData.subId}`, JSON.stringify(questionsForLocalStorage));

            const subIdInfoElement = document.getElementById('subIdInfo');
            let infoHtml = `<h4>${currentAssignmentData.assignmentTitle || currentAssignmentData.assignmentId} - ${currentAssignmentData.subId}</h4>`;
            
            if (currentAssignmentData.questions.length > 0) {
                infoHtml += '<div class="questions-container"><ol>';
                // Iteriere über das Array der Fragen und zeige nur den question_text an
                currentAssignmentData.questions.forEach(q => { infoHtml += `<li>${parseMarkdown(q.question_text)}</li>`; });
                infoHtml += '</ol></div>';
            }
            subIdInfoElement.innerHTML = infoHtml;

            loadContent();
            loadAndDisplayAttachments();

        } catch (error) {
            console.error('Fehler beim Laden oder Verarbeiten der Fragen:', error);
            document.getElementById('subIdInfo').innerHTML = `<h4 style="color:red;">Fehler beim Laden der Aufgabe: ${error.message}</h4>`;
        }
    }


    // --- PAGE INITIALIZATION ---
    document.addEventListener("DOMContentLoaded", function() {
        initializeDB();

        const Delta = Quill.import('delta');

        quill = new Quill('#answerBox', {
            theme: 'snow',
            placeholder: 'Hier können Bilder eingefügt werden. Text kann geschrieben, aber nicht eingefügt werden.',
            modules: {
                toolbar: [
                    ['bold', 'italic', 'underline'],
                    [{ 'list': 'ordered' }, { 'list': 'bullet' }],
                    ['clean'],
                    ['image']
                ],
                clipboard: {
                    matchers: [
                        [Node.TEXT_NODE, (node, delta) => {
                            if (node.textContent && node.textContent.trim().length > 0) {
                                showPasteError();
                            }
                            return new Delta(); // Leeres Delta-Objekt zurückgeben, um eingefügten Text zu ignorieren
                        }]
                    ]
                }
            }
        });
        
        quill.on('text-change', debouncedSave);

        // Rufe die neue Funktion auf, um Aufgabe und Fragen zu laden
        loadAssignmentAndQuestions();
        
        document.getElementById('file-attachment').addEventListener('change', (event) => {
            const file = event.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                // Sicherstellen, dass currentAssignmentData verfügbar ist, bevor Anhang gespeichert wird
                if (!currentAssignmentData.assignmentId || !currentAssignmentData.subId) {
                    alert("Bitte laden Sie zuerst eine Aufgabe, bevor Sie Anhänge hinzufügen.");
                    return;
                }
                saveAttachment({
                    assignmentId: currentAssignmentData.assignmentId,
                    subId: currentAssignmentData.subId,
                    fileName: file.name,
                    fileType: file.type,
                    data: e.target.result // Base64-String des Dateiinhalts
                });
            };
            reader.readAsDataURL(file); // Datei als Data URL lesen (Base64)
            event.target.value = null; // Eingabefeld zurücksetzen, damit dieselbe Datei erneut ausgewählt werden kann
        });

        document.getElementById('current-attachments').addEventListener('click', (event) => {
            if (event.target && event.target.classList.contains('remove-attachment-btn')) {
                const fileId = parseInt(event.target.getAttribute('data-id'), 10);
                if (confirm('Bist du sicher, dass du diesen Anhang entfernen möchtest?')) {
                    deleteAttachment(fileId);
                }
            }
        });

        // Event Listener für alle Buttons
        document.getElementById('submitAssignmentBtn')?.addEventListener('click', submitAssignment);
        document.getElementById('printAssignmentBtn')?.addEventListener('click', printAssignment);
        
        const importBtn = document.getElementById('importLocalBackupBtn');
        const importFileInput = document.getElementById('importFileInput');
        importBtn?.addEventListener('click', () => importFileInput.click());
        importFileInput?.addEventListener('change', importLocalBackup);
    });

})();
