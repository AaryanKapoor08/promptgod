
%-------------------------
% Resume in LaTeX
% Author : Aaryan Kapoor
% Based on: https://github.com/sb2nov/resume
% License : MIT
%------------------------

\documentclass[letterpaper,11pt]{article}

\usepackage{latexsym}
\usepackage[empty]{fullpage}
\usepackage{titlesec}
\usepackage{marvosym}
\usepackage[usenames,dvipsnames]{color}
\usepackage{verbatim}
\usepackage{enumitem}
\usepackage[hidelinks]{hyperref}
\usepackage{fancyhdr}
\usepackage[english]{babel}
\usepackage{tabularx}
\usepackage{fontawesome5}
\usepackage{multicol}
\setlength{\multicolsep}{-3.0pt}
\setlength{\columnsep}{-1pt}
\input{glyphtounicode}

\pagestyle{fancy}
\fancyhf{}
\fancyfoot{}
\renewcommand{\headrulewidth}{0pt}
\renewcommand{\footrulewidth}{0pt}

% Adjust margins
\addtolength{\oddsidemargin}{-0.6in}
\addtolength{\evensidemargin}{-0.5in}
\addtolength{\textwidth}{1.19in}
\addtolength{\topmargin}{-.7in}
\addtolength{\textheight}{1.4in}

\urlstyle{same}

\raggedbottom
\raggedright
\setlength{\tabcolsep}{0in}

% Sections formatting
\titleformat{\section}{
  \vspace{-4pt}\scshape\raggedright\large\bfseries
}{}{0em}{}[\color{black}\titlerule \vspace{-5pt}]

% Ensure that generate pdf is machine readable/ATS parsable
\pdfgentounicode=1

%-------------------------
% Custom commands
\newcommand{\resumeItem}[1]{
  \item\small{
    {#1 \vspace{-2pt}}
  }
}

\newcommand{\classesList}[4]{
    \item\small{
        {#1 #2 #3 #4 \vspace{-2pt}}
  }
}

\newcommand{\resumeSubheading}[4]{
  \vspace{-2pt}\item
    \begin{tabular*}{1.0\textwidth}[t]{l@{\extracolsep{\fill}}r}
      \textbf{#1} & \textbf{\small #2} \\
      \textit{\small#3} & \textit{\small #4} \\
    \end{tabular*}\vspace{-7pt}
}

% One-line heading: title -- role on the left, date on the right
\newcommand{\resumeExpHeading}[2]{
  \vspace{-2pt}\item
    \begin{tabular*}{1.0\textwidth}[t]{l@{\extracolsep{\fill}}r}
      \textbf{#1} & \textbf{\small #2} \\
    \end{tabular*}\vspace{-5pt}
}

\newcommand{\resumeSubSubheading}[2]{
    \item
    \begin{tabular*}{1.0\textwidth}{l@{\extracolsep{\fill}}r}
      \textit{\small#1} & \textit{\small #2} \\
    \end{tabular*}\vspace{-7pt}
}

\newcommand{\resumeProjectHeading}[2]{
    \item
    \begin{tabular*}{1.001\textwidth}{l@{\extracolsep{\fill}}r}
      \small#1 & \textbf{\small #2}\\
    \end{tabular*}\vspace{-7pt}
}

\newcommand{\resumeSubItem}[1]{\resumeItem{#1}\vspace{-4pt}}

\renewcommand\labelitemi{$\vcenter{\hbox{\tiny$\bullet$}}$}
\renewcommand\labelitemii{$\vcenter{\hbox{\tiny$\bullet$}}$}

\newcommand{\resumeSubHeadingListStart}{\begin{itemize}[leftmargin=0.0in, label={}]}
\newcommand{\resumeSubHeadingListEnd}{\end{itemize}}
\newcommand{\resumeItemListStart}{\begin{itemize}}
\newcommand{\resumeItemListEnd}{\end{itemize}\vspace{-5pt}}

%-------------------------------------------
%%%%%%  RESUME STARTS HERE  %%%%%%%%%%%%%%%%%%%%%%%%%%%%

\begin{document}

%----------HEADING----------
\begin{center}
    {\Huge \scshape Aaryan Kapoor} \\ \vspace{1pt}
    \small \raisebox{-0.1\height}\faPhone\ +1 647 218 2320 ~ 
    \href{mailto:aaryan.kapoor@unb.ca}{\raisebox{-0.2\height}\faEnvelope\  \underline{aaryan.kapoor@unb.ca}} ~ 
    \href{https://linkedin.com/in/aaryan-kapoor-88a007332/}{\raisebox{-0.2\height}\faLinkedin\ \underline{linkedin.com/in/aaryan-kapoor-88a007332}} ~
    \href{https://github.com/AaryanKapoor08}{\raisebox{-0.2\height}\faGithub\ \underline{github.com/AaryanKapoor08}}
    \vspace{-8pt}
\end{center}

%-----------SUMMARY-----------
\section{Summary}
Rising third-year Computer Science student building an agentic AI stack end to end, from retrieval pipelines and autonomous agents to the full-stack products they run inside. Strong across Python and the modern JavaScript ecosystem, with hands-on work in RAG, LangGraph-based agents, and LLM provider orchestration. Oracle GenAI certified, drawn to projects where the engineering around the model matters as much as the model itself, currently shipping open-source work and preparing for Google Summer of Code 2026.

%-----------PROGRAMMING SKILLS-----------
\section{Technical Skills}
 \begin{itemize}[leftmargin=0.15in, label={}]
    \small{\item{
     \textbf{Programming \& Frameworks}{: JavaScript, TypeScript, Python, Java, React.js, Next.js, Node.js, Express.js} \\
     \textbf{AI \& Machine Learning}{: RAG (Traditional, Multimodal, Agentic), LangChain, LangGraph, LangSmith, DSPy, LLMs, NLP, Transformer Architecture, Hybrid \& Semantic Search, BM25} \\
     \textbf{Web \& Databases}{: HTML, CSS, Tailwind CSS, REST APIs, WebRTC, Supabase, MongoDB, SQL, PostgreSQL, SQLite, Vector DBs (FAISS, Pinecone, LanceDB)} \\
     \textbf{DevOps \& Cloud}{: Docker, Kubernetes, CI/CD Pipelines, Git, GitHub Actions, Jenkins, AWS, Oracle Cloud (OCI), ETL Pipelines} \\
     \textbf{Tools \& Platforms}{: Solidity, Hardhat, ethers.js, pytest, Pydantic, Vitest, Vite, Vercel, Chrome Extensions (Manifest V3)} \\
    }}
 \end{itemize}
 \vspace{-16pt}

%-----------EXPERIENCE-----------
\section{Experience}
  \resumeSubHeadingListStart

    \resumeExpHeading
      {Hastinapur Metals Pvt. Ltd. -- Freelance Web Developer (Remote)}{2026}
      \resumeItemListStart
        \resumeItem{Built a robust website to run the firm's day-to-day operations, replacing manual tracking with a structured catalog, enquiry handling, and a direct admin view.}
      \resumeItemListEnd

    \resumeExpHeading
      {Dual-Use Technology Hackathon, UNB -- Participant}{May 2026}
      \resumeItemListStart
        \resumeItem{Built Fluo, a defence procurement workflow and blockchain audit-ledger proof of concept, in a 48-hour build addressing dual-use technology for Canadian defence.}
      \resumeItemListEnd

    \resumeExpHeading
      {GirlScript Summer of Code -- Open Source Contributor (Remote)}{2026}
      \resumeItemListStart
        \resumeItem{Active contributor in a large open-source mentorship program, resolving issues and landing merged pull requests across community-maintained repositories.}
      \resumeItemListEnd

    \resumeExpHeading
      {Code Social, Winter of Code -- Open Source Contributor (Remote)}{Nov 2025 -- Present}
      \resumeItemListStart
        \resumeItem{Contributing across multiple repositories in a 3-month seasonal program through code reviews, pull requests, and issue triage.}
      \resumeItemListEnd

    \resumeExpHeading
      {Fredericton Ideation Boost Camp 2026 -- Lead Developer}{January 2026}
      \resumeItemListStart
        \resumeItem{Led a 3-person team to design and pitch Auctus, an AI funding-discovery platform, and shipped a working MVP within the 48-hour camp.}
      \resumeItemListEnd

  \resumeSubHeadingListEnd
\vspace{-16pt}

%-----------PROJECTS-----------
\section{Projects}
    \resumeSubHeadingListStart

      \resumeProjectHeading
          {\textbf{PromptGod} $|$ \emph{Manifest V3, TypeScript, Vite} $|$ \href{https://github.com/AaryanKapoor08/promptgod}{\underline{GitHub}}}{November 2025 -- Present}
          \resumeItemListStart
            \resumeItem{Architected a Manifest V3 Chrome extension that rewrites rough prompts into model-ready instructions across ChatGPT, Claude, Gemini, and Perplexity, treating each rewrite as a constrained compiler pass rather than a template substitution.}
            \resumeItem{Engineered a compiler-style pipeline of local constraint extraction, issue-code validation, deterministic repair, and a single targeted retry over a curated Gemini, Gemma, and OpenRouter Nemotron fallback chain, holding fixed prompt overhead to roughly 700 to 850 tokens per call.}
            \resumeItem{Isolated rewrite branches for chat composers and highlighted text behind per-site platform adapters, with near-echo and system-prompt wrapper rejection that gates low-effort model output before it reaches the page.}
          \resumeItemListEnd
          \vspace{-13pt}

      \resumeProjectHeading
          {\textbf{Software Maintenance Agent} $|$ \emph{Python, DSPy, pytest, SQLite} $|$ \href{https://github.com/AaryanKapoor08/software_maintenance_agent}{\underline{GitHub}}}{April 2026 -- Present}
          \resumeItemListStart
            \resumeItem{A local agent for small, testable fixes that takes a task, reproduces the failure inside a sandboxed copy, finds the likely files, applies a focused patch, reruns the tests, and writes a report.}
            \resumeItem{Ranks candidate files with BM25 and hybrid retrieval, traces every step to SQLite behind a browser dashboard, and stays safe through secret redaction, command allow-listing, and path-scoped edits; in active development.}
          \resumeItemListEnd
          \vspace{-13pt}

      \newpage

      \resumeProjectHeading
          {\textbf{Auctus} $|$ \emph{Next.js 16, React 19, Supabase} $|$ \href{https://auctus-five.vercel.app/}{\underline{Live}} $\cdot$ \href{https://github.com/AaryanKapoor08/auctus}{\underline{GitHub}}}{January 2026 -- Present}
          \resumeItemListStart
            \resumeItem{A Canadian funding-discovery platform serving three roles: businesses pursuing grants, students seeking scholarships and bursaries, and professors sourcing research funding, built on Next.js 16, React 19, and Supabase.}
            \resumeItem{Implemented role-based onboarding, profile-derived match scoring against a canonical funding tag taxonomy, and Postgres row-level security across identity, funding, and forum domains, fed by a TypeScript scraper that ingests official funding sources.}
          \resumeItemListEnd
          \vspace{-13pt}

      \resumeProjectHeading
          {\textbf{Fluo, Defence Procurement Ledger} $|$ \emph{Next.js, React Flow, Solidity, Hardhat}}{May 2026}
          \resumeItemListStart
            \resumeItem{Presented at UNB's Dual-Use Hackathon: a proof of concept that scores vendor risk, blocks flagged procurement paths, and writes tamper-evident audit events to a Solidity ledger on a local Hardhat chain, with the workflow rendered on a React Flow canvas.}
          \resumeItemListEnd
          \vspace{-13pt}

      \resumeProjectHeading
          {\textbf{Agentic RAG Pipeline} $|$ \emph{Python, LangGraph, LangChain, LangSmith}}{2026}
          \resumeItemListStart
            \resumeItem{An autonomous retrieval system where a LangGraph state machine runs planner, retriever, and critic roles that grade their own context and re-retrieve when relevance drops, with self-correcting loops traced end to end in LangSmith.}
            \resumeItem{Routes each query by confidence between a direct answer, a tool call, and deeper retrieval, and persists conversational memory across turns for multi-step reasoning.}
          \resumeItemListEnd
          \vspace{-13pt}

      \resumeProjectHeading
          {\textbf{Multimodal RAG Pipeline} $|$ \emph{Python, LangChain, FAISS, CLIP}}{2026}
          \resumeItemListStart
            \resumeItem{Indexes text and images in a shared embedding space with CLIP-style encoders and a hybrid FAISS and BM25 retriever with a reranking stage, so a single query returns the relevant passages and figures together.}
            \resumeItem{Persists embeddings to a local vector store and answers with citations back to the exact source page or image, keeping responses grounded and auditable.}
            \vspace{2pt}
          \resumeItemListEnd
          \vspace{-13pt}

\resumeSubHeadingListEnd
\vspace{-10pt}

%-----------CERTIFICATIONS-----------

\section{Awards \& Certifications}
    \begin{itemize}[leftmargin=0.15in, label={}]
        \small{\item{
            \textbf{RAG Bootcamp -- Udemy (May 2026)}{: Built traditional, advanced, multimodal, and agentic RAG pipelines with LangChain, LangGraph, and LangSmith, covering hybrid search, persistent memory, and multi-agent retrieval over FAISS and Pinecone.} \\
            \textbf{Oracle GenAI Certified -- Oracle (November 2025)}{: Worked through transformer architecture, RAG systems, and vector embeddings with hands-on OCI Generative AI labs focused on semantic retrieval.} \\
            \textbf{Oracle APEX Cloud Developer Certified Professional -- Oracle (November 2025)}{: Built secure, scalable low-code enterprise applications on Oracle APEX with generative AI features, dynamic reports, and workflow automation.} \\
            \textbf{HackFest Hackathon -- GDG Cloud New Delhi (November 2025)}{: Built full-stack applications with TypeScript, React, WebRTC, and real-time communication under competition time limits.} \\
        }}
    \end{itemize}
 \vspace{-16pt}

%-----------VOLUNTEER EXPERIENCE-----------
\section{Volunteer Experience}
    \begin{itemize}[leftmargin=0.15in, label={}]
        \small{\item{
            \textbf{Atlantic AI Summit 2026 -- Volunteer (June 2026, Fredericton, NB)}{: Helped run Atlantic Canada's flagship applied-AI gathering hosted by UNB's RIDSAI, supporting on-site logistics across keynotes, panels, and workshops over the three-day event.} \\
        }}
    \end{itemize}
 \vspace{-16pt}

%-----------EDUCATION-----------
\section{Education}
  \resumeSubHeadingListStart
  \resumeSubheading
  {University of New Brunswick}{September 2024 -- April 2028}
  {Bachelor of Science in Computer Science (Rising 3rd Year)}{Fredericton, NB}
      \resumeItemListStart
        \resumeItem{Relevant Coursework: Java, C, SQL, Calculus I \& II, Statistics, Data Analysis, Machine Language}
      \resumeItemListEnd

    \resumeSubheading
      {Jaspal Kaur Public School}{April 2023 -- March 2024}
      {High School Diploma -- Physics, Chemistry \& Mathematics}{India}
      \resumeItemListStart
        \resumeItem{Grade: 84\%}
        \resumeItem{Developed Python games using Pygame \& Turtle including Snake Game and Tic-Tac-Toe with AI logic, gaining early experience in game mechanics and algorithm implementation.}
      \resumeItemListEnd
  \resumeSubHeadingListEnd

\end{document}
```
