"""Example: single-project maintenance crew with Sonder instrumentation.

Run with:
    OPENAI_API_KEY=sk-... python examples/maintenance_crew.py
"""
import os

from crewai import Agent, Crew, Process, Task

from sonder_crewai import (
    CapabilityContext,
    GovernanceContext,
    MemoryContext,
    ReasoningContext,
    SonderCrewMiddleware,
    SonderTaskConfig,
    configure_task,
)

PROJECT = "sonder"
PROJECT_PATH = os.path.expanduser("~/sonder")

# --- Agents ---

product_analyst = Agent(
    role="ProductAnalyst",
    goal="Determine whether the project is aligned with its stated purpose or drifting",
    backstory="Senior product strategist who reads READMEs, changelogs, and issue trackers to detect scope creep and purpose drift.",
    verbose=True,
)

tech_debt_investigator = Agent(
    role="TechDebtInvestigator",
    goal="Identify poor engineering practices, ignored patterns, and improvement opportunities",
    backstory="Senior engineer with a nose for code smell, missing tests, and architectural shortcuts.",
    verbose=True,
)

bug_hunter = Agent(
    role="BugHunter",
    goal="Surface potential bugs and unhandled edge cases not caught by existing tests",
    backstory="QA specialist who reads code paths the happy-path tests miss.",
    verbose=True,
)

doc_auditor = Agent(
    role="DocAuditor",
    goal="Verify that documentation is accurate and matches the current implementation",
    backstory="Technical writer who cross-references READMEs, docstrings, and changelogs against actual code.",
    verbose=True,
)

red_teamer = Agent(
    role="RedTeamer",
    goal="Challenge whether features do what they claim — find gaps between spec and reality",
    backstory="Adversarial tester who asks 'does this actually work?' rather than 'does the code look right?'",
    verbose=True,
)

# --- Tasks ---

product_analysis_task = configure_task(
    Task(
        description=(
            f"Analyze the {PROJECT} project at {PROJECT_PATH}. "
            "Read the README, CHANGELOG, and any spec files. "
            "Identify: (1) stated purpose, (2) signs of drift from that purpose, "
            "(3) top 3 strengths to build on, (4) top 3 weaknesses to address."
        ),
        expected_output="A product alignment report with drift signals, strengths, and weaknesses.",
        agent=product_analyst,
    ),
    sonder=SonderTaskConfig(
        capabilities=CapabilityContext(mounted=["read_file", "list_dir"]),
        reasoning=ReasoningContext(neurotypes=["strategic", "critical"]),
    ),
)

tech_debt_task = configure_task(
    Task(
        description=(
            f"Investigate technical debt in {PROJECT} at {PROJECT_PATH}. "
            "Look for: missing tests, TODO/FIXME comments, inconsistent patterns, "
            "deprecated dependencies, and architectural shortcuts."
        ),
        expected_output="A prioritized list of tech debt items with severity and suggested remediation.",
        agent=tech_debt_investigator,
    ),
    sonder=SonderTaskConfig(
        capabilities=CapabilityContext(mounted=["read_file", "grep", "list_dir"]),
        reasoning=ReasoningContext(neurotypes=["engineering", "critical"]),
    ),
)

bug_analysis_task = configure_task(
    Task(
        description=(
            f"Hunt for potential bugs in {PROJECT} at {PROJECT_PATH}. "
            "Focus on: unhandled errors, null/undefined edge cases, race conditions, "
            "off-by-one errors, and missing input validation."
        ),
        expected_output="A list of potential bugs with file locations, severity, and reproduction scenario.",
        agent=bug_hunter,
    ),
    sonder=SonderTaskConfig(
        capabilities=CapabilityContext(mounted=["read_file", "grep"]),
        reasoning=ReasoningContext(neurotypes=["adversarial", "systematic"]),
    ),
)

doc_audit_task = configure_task(
    Task(
        description=(
            f"Audit documentation for {PROJECT} at {PROJECT_PATH}. "
            "Check: README accuracy, docstring completeness, CHANGELOG currency, "
            "and whether examples in docs actually match the current API."
        ),
        expected_output="A documentation audit report listing stale, missing, or inaccurate content.",
        agent=doc_auditor,
    ),
    sonder=SonderTaskConfig(
        capabilities=CapabilityContext(mounted=["read_file", "list_dir"]),
        reasoning=ReasoningContext(neurotypes=["editorial", "systematic"]),
    ),
)

red_team_task = configure_task(
    Task(
        description=(
            f"Red-team the {PROJECT} project at {PROJECT_PATH}. "
            "Pick 3 key features or claims from the README/docs. "
            "For each: (1) state the claim, (2) find evidence it works or fails, "
            "(3) identify what's missing between spec and implementation."
        ),
        expected_output="A red-team report with 3 claim-vs-reality assessments.",
        agent=red_teamer,
    ),
    sonder=SonderTaskConfig(
        capabilities=CapabilityContext(mounted=["read_file", "grep", "run_tests"]),
        reasoning=ReasoningContext(neurotypes=["adversarial", "skeptical"]),
    ),
)

# --- Crew + Sonder ---

crew = Crew(
    agents=[product_analyst, tech_debt_investigator, bug_hunter, doc_auditor, red_teamer],
    tasks=[product_analysis_task, tech_debt_task, bug_analysis_task, doc_audit_task, red_team_task],
    process=Process.sequential,
    verbose=True,
)

wrapped = SonderCrewMiddleware(
    crew,
    audit_log_path=f"./sonder-audit-{PROJECT}.jsonl",
    workflow_id=f"maintenance:{PROJECT}:daily",
)

result = wrapped.kickoff(inputs={"project": PROJECT, "project_path": PROJECT_PATH})

print("\n--- Maintenance Report ---")
print(result.raw)
print(f"\n--- Sonder audit log: ./sonder-audit-{PROJECT}.jsonl ---")
