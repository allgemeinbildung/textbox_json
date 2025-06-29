// quiz.js - v8 (Fixed SUB_STORAGE_PREFIX definition)
(function() {
    'use strict';

    // --- CONSTANTS & STATE ---
    // Diese Präfixe bleiben gleich, da sie die Art der im localStorage gespeicherten Daten definieren.
    // 'textbox-quizdata_' speichert die Antworten des Benutzers für das Quiz.
    // 'textbox-questions_' speichert die Quizfragen selbst (für den Export/Backup).
    const QUIZ_ANSWERS_PREFIX = 'textbox-quizdata_';
    const QUIZ_QUESTIONS_PREFIX = 'textbox-questions_'; // Angleichung an script.js, um Fragen gemeinsam zu speichern
    const SUB_STORAGE_PREFIX = 'textbox-sub_'; // <-- DIESE DEFINITION WURDE HINZUGEFÜGT/KORRIGIERT

    // Holt assignmentId und subId aus der URL
    const params = new URLSearchParams(window.location.search);
    const assignmentId = params.get('assignmentId');
    const subId = params.get('subId'); // Geändert von 'Id' zu 'subId'

    let state = {
        allQuestions: [], // Die gemischten Quizfragen für die aktuelle Sitzung
        currentQuestionIndex: 0,
        userAnswers: {}, // Speichert { q_original_index: { answer: '...', isCorrect: true/false } }
        quizMetadata: {}, // Speichert Metadaten des spezifischen Quiz (title, customIntroText, media)
        answersStorageKey: '', // Schlüssel für die Speicherung der Antworten im localStorage
        questionsStorageKey: '' // Schlüssel für die Speicherung der Fragen im localStorage
    };

    // --- DOM ELEMENTS ---
    const elements = {
        title: document.getElementById('assignment-title'),
        subTitle: document.getElementById('sub-id-title'),
        intro: document.getElementById('intro-text'),
        indicator: document.getElementById('saveIndicator'),
        quizMain: document.getElementById('quiz-main'),
        questionArea: document.getElementById('question-area'),
        feedbackArea: document.getElementById('feedback-area'),
        navigation: document.getElementById('quiz-navigation'),
        progressIndicator: document.getElementById('progress-indicator'),
        nextBtn: document.getElementById('next-btn'),
        resultsScreen: document.getElementById('results-screen'),
        resultsSummary: document.getElementById('results-summary'),
        startNewNavBtn: document.getElementById('start-new-btn-nav'),
        startNewResultsBtn: document.getElementById('start-new-btn-results'),
        header: document.getElementById('quiz-header')
    };

    // --- INITIALIZATION ---
    if (!assignmentId || !subId) {
        elements.title.textContent = "Fehler";
        elements.quizMain.style.display = 'block';
        elements.questionArea.innerHTML = "<p>Ein 'assignmentId' und 'subId' Parameter in der URL sind erforderlich, um das Quiz zu laden (z.B. ?assignmentId=3.4 Migration, Integration und Rassismus&subId=Grundlagen_Quiz).</p>";
        elements.navigation.style.display = 'none';
        return;
    }

    // Konstruiere den Pfad zur JSON-Datei im 'assignments/' Ordner
    const jsonFileName = assignmentId.replace(/ /g, '_') + '.json'; // Ersetze Leerzeichen durch Unterstriche
    const assignmentJsonPath = `assignments/${jsonFileName}`;

    async function initializeQuiz() {
        try {
            const response = await fetch(assignmentJsonPath);
            if (!response.ok) {
                throw new Error(`Netzwerk-Fehler beim Laden von ${assignmentJsonPath}: ${response.statusText}`);
            }
            const data = await response.json();

            // Prüfen, ob die Hauptaufgabe und die spezifische Quiz-Sektion existieren
            if (!data.assignmentId || !data.quizzes || !data.quizzes[subId]) {
                throw new Error(`Die JSON-Datei '${jsonFileName}' enthält nicht die erwartete 'assignmentId' oder die 'subId' '${subId}' wurde im 'quizzes'-Abschnitt nicht gefunden.`);
            }

            // Die spezifischen Quiz-Daten aus der JSON-Datei extrahieren
            const specificQuizData = data.quizzes[subId];
            if (!specificQuizData.questions || !Array.isArray(specificQuizData.questions)) {
                 throw new Error(`Das Quiz '${subId}' enthält keine gültigen Fragen.`);
            }

            state.quizMetadata = specificQuizData; // Speichert spezifische Quiz-Metadaten
            state.allQuestions = specificQuizData.questions.map((q, index) => ({ ...q, originalIndex: index }));
            
            // Schlüssel für localStorage basierend auf assignmentId und subId
            state.answersStorageKey = `${QUIZ_ANSWERS_PREFIX}${assignmentId}_${SUB_STORAGE_PREFIX}${subId}`;
            state.questionsStorageKey = `${QUIZ_QUESTIONS_PREFIX}${assignmentId}_${SUB_STORAGE_PREFIX}${subId}`;
            
            elements.title.textContent = specificQuizData.title || assignmentId.split('_').join(' ');
            elements.subTitle.textContent = subId;
            if (specificQuizData.customIntroText) {
                elements.intro.innerHTML = specificQuizData.customIntroText;
                elements.intro.style.display = 'block';
            }

            // Speichert die Fragen im localStorage, damit script.js (und verifier.html) sie finden können
            localStorage.setItem(state.questionsStorageKey, JSON.stringify(specificQuizData.questions));

            setupQuiz();

        } catch (error) {
            console.error('Fehler beim Laden oder Verarbeiten des Quiz:', error);
            elements.title.textContent = "Quiz konnte nicht geladen werden";
            elements.header.style.borderBottom = 'none';
            elements.quizMain.style.display = 'block';
            elements.quizMain.innerHTML = `<p>Die Quiz-Datei unter <strong>${assignmentJsonPath}</strong> konnte nicht geladen oder verarbeitet werden, oder die angegebene 'subId' wurde nicht gefunden. Fehlermeldung: ${error.message}</p>`;
            elements.navigation.style.display = 'none';
        }
    }

    // --- QUIZ SETUP AND RENDERING ---

    function setupQuiz() {
        loadAnswers();
        shuffle(state.allQuestions);
        state.currentQuestionIndex = 0;
        elements.quizMain.style.display = 'block';
        elements.navigation.style.display = 'flex';
        elements.resultsScreen.style.display = 'none';
        renderCurrentQuestion();
    }

    function renderCurrentQuestion() {
        elements.feedbackArea.innerHTML = '';
        elements.nextBtn.disabled = true;

        if (state.currentQuestionIndex >= state.allQuestions.length) {
            showResults();
            return;
        }

        const q = state.allQuestions[state.currentQuestionIndex];
        const questionId = `q${q.originalIndex}`; // Verwende originalIndex, um die Frage im state.userAnswers zu identifizieren
        let formHtml = `<div class="question-item" id="item-${questionId}">`;
        formHtml += `<div class="question-text"><p>${q.question}</p></div>`;
        formHtml += `<form class="options-container">`;

        // Optionen rendern basierend auf Fragetyp
        const options = (q.type === 'MultipleChoice') 
            ? q.options.map((opt, i) => ({ value: i, text: opt.text }))
            : [{ value: 'true', text: 'Richtig' }, { value: 'false', text: 'Falsch' }];

        options.forEach(opt => {
            formHtml += `<label><input type="radio" name="${questionId}" value="${opt.value}" required> <span>${opt.text}</span></label>`;
        });

        formHtml += `</form></div>`;
        elements.questionArea.innerHTML = formHtml;
        
        elements.questionArea.querySelector('.options-container').addEventListener('change', handleAnswerSelection);
        elements.progressIndicator.textContent = `Frage ${state.currentQuestionIndex + 1} von ${state.allQuestions.length}`;

        // Wenn bereits eine Antwort für diese Frage gespeichert ist, anzeigen
        if (state.userAnswers[questionId]) {
            const savedAnswer = state.userAnswers[questionId].answer;
            const radio = elements.questionArea.querySelector(`input[name="${questionId}"][value="${savedAnswer}"]`);
            if (radio) {
                radio.checked = true;
                showFeedback(questionId);
                disableOptions(questionId);
                elements.nextBtn.disabled = false;
            }
        }
    }

    function showFeedback(questionId) {
        // Die Originalfrage aus den Metadaten finden, da allQuestions gemischt sein könnte
        const originalIndex = parseInt(questionId.replace('q', ''));
        const questionData = state.quizMetadata.questions[originalIndex]; // Zugriff über quizMetadata.questions
        const selectedRadio = elements.questionArea.querySelector(`input[name="${questionId}"]:checked`);

        if (!selectedRadio || !questionData) return;

        let isCorrect = false;
        let feedbackHtml = '';

        if (questionData.type === 'MultipleChoice') {
            const selectedOption = questionData.options[selectedRadio.value];
            isCorrect = selectedOption.is_correct;
            feedbackHtml = selectedOption.feedback;
        } else if (questionData.type === 'TrueFalse') {
            isCorrect = (selectedRadio.value === String(questionData.correct_answer));
            feedbackHtml = isCorrect ? questionData.feedback_correct : questionData.feedback_incorrect;
        }

        // Antwort im Zustand speichern
        state.userAnswers[questionId] = { answer: selectedRadio.value, isCorrect: isCorrect };
        elements.feedbackArea.innerHTML = `<div class="feedback-container ${isCorrect ? 'feedback-correct' : 'feedback-incorrect'}">${feedbackHtml}</div>`;
    }

    // --- EVENT HANDLERS ---
    
    function handleAnswerSelection(event) {
        if (event.target.type === 'radio') {
            const questionId = event.target.name;
            showFeedback(questionId);
            saveAnswers();
            disableOptions(questionId);
            elements.nextBtn.disabled = false;
        }
    }
    
    function handleNextClick() {
        state.currentQuestionIndex++;
        renderCurrentQuestion();
    }
    
    /**
     * Handles the logic to completely reset the quiz.
     */
    function startNewQuiz() {
        const confirmed = confirm("Möchten Sie wirklich neu beginnen? Alle Ihre bisherigen Antworten für dieses Quiz werden gelöscht.");
        if (confirmed) {
            // 1. Gespeicherte Daten für dieses spezifische Quiz löschen
            localStorage.removeItem(state.answersStorageKey);

            // 2. Den In-Memory-Zustand für Antworten zurücksetzen
            state.userAnswers = {};
            
            // 3. Benutzer informieren und den Quizablauf neu starten
            alert("Die gespeicherten Antworten wurden gelöscht. Das Quiz wird neu gestartet.");
            setupQuiz();
        }
    }
    
    // --- DATA & STATE MANAGEMENT ---
    function shuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }

    function disableOptions(questionId) {
        const container = elements.questionArea.querySelector(`#item-${questionId}`);
        const radios = container.querySelectorAll(`input[name="${questionId}"]`);
        radios.forEach(radio => {
            radio.disabled = true;
            if(radio.checked) {
                radio.parentElement.classList.add('selected');
            }
        });
    }

    function saveAnswers() {
        localStorage.setItem(state.answersStorageKey, JSON.stringify({ answeredQuestions: state.userAnswers }));
        showSaveIndicator();
    }

    /**
     * Loads saved answers from local storage into the state.
     * This version is more robust against corrupted or invalid stored data.
     */
    function loadAnswers() {
        const savedData = localStorage.getItem(state.answersStorageKey);
        
        // Immer mit einem leeren Zustand im Speicher beginnen.
        state.userAnswers = {};

        if (savedData) {
            try {
                const results = JSON.parse(savedData);
                // Nur zuweisen, wenn die geparsten Daten ein Objekt sind und die erwartete Eigenschaft haben.
                if (results && typeof results === 'object' && results.answeredQuestions) {
                   state.userAnswers = results.answeredQuestions;
                }
            } catch (e) {
                console.error("Fehler beim Laden der Antworten. Gespeicherte Daten sind ungültig und werden ignoriert.", e);
                // state.userAnswers ist bereits {}, daher fahren wir mit einem frischen Quiz-Zustand fort.
            }
        }
    }
    
    function showSaveIndicator() {
        elements.indicator.style.opacity = '1';
        setTimeout(() => {
            elements.indicator.style.opacity = '0';
        }, 1500);
    }
    
    // --- QUIZ COMPLETION ---

    function showResults() {
        elements.quizMain.style.display = 'none';
        elements.navigation.style.display = 'none';
        elements.resultsScreen.style.display = 'block';

        const totalQuestions = state.allQuestions.length;
        const correctAnswers = Object.values(state.userAnswers).filter(answer => answer.isCorrect).length;
        
        elements.resultsSummary.textContent = `Du hast ${correctAnswers} von ${totalQuestions} Fragen richtig beantwortet.`;
    }

    // --- EVENT LISTENERS ---
    document.addEventListener('DOMContentLoaded', initializeQuiz); // Startet die Initialisierung des Quiz
    elements.nextBtn.addEventListener('click', handleNextClick);
    elements.startNewNavBtn.addEventListener('click', startNewQuiz);
    elements.startNewResultsBtn.addEventListener('click', startNewQuiz);

})();
