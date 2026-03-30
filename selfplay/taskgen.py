#!/usr/bin/env python3
"""
Self-Play Task Generator - Generates coding tasks for Rasputin training

Creates realistic coding tasks from GitHub issues or synthetic generation.
Tasks are categorized by difficulty and include test criteria.

Usage:
    python selfplay_taskgen.py --count 10 --difficulty medium
    python selfplay_taskgen.py --count 5 --difficulty easy --output tasks.json
"""

import sys
import json
import random
import argparse
from typing import List, Dict, Any
from datetime import datetime

try:
    import requests
except ImportError:
    print("Error: requests library required. Install with: pip install requests")
    sys.exit(1)


class TaskGenerator:
    """Generates coding tasks for self-play training"""

    def __init__(self, verbose: bool = False):
        self.verbose = verbose
        
        # Task templates by difficulty
        self.templates = {
            "easy": [
                {
                    "title": "Add input validation to function",
                    "description": "Add input validation to check if parameter is a valid {type}. Return error message if invalid.",
                    "type": "bug_fix",
                    "files": 1,
                    "test_criteria": ["Input validation exists", "Error message returned for invalid input", "Valid input passes through"]
                },
                {
                    "title": "Fix typo in variable name",
                    "description": "Fix typo in variable name '{old_name}' to '{new_name}' throughout the file.",
                    "type": "refactor",
                    "files": 1,
                    "test_criteria": ["All instances of typo fixed", "Code still runs correctly"]
                },
                {
                    "title": "Add logging to function",
                    "description": "Add debug logging statements to function {func_name} to log input parameters and return value.",
                    "type": "feature",
                    "files": 1,
                    "test_criteria": ["Log statements added", "Input parameters logged", "Return value logged"]
                },
                {
                    "title": "Add docstring to function",
                    "description": "Add comprehensive docstring to {func_name} function including parameters, return value, and examples.",
                    "type": "documentation",
                    "files": 1,
                    "test_criteria": ["Docstring present", "Parameters documented", "Return value documented", "Example provided"]
                },
                {
                    "title": "Extract magic number to constant",
                    "description": "Replace magic number {number} with a named constant {constant_name} at the top of the file.",
                    "type": "refactor",
                    "files": 1,
                    "test_criteria": ["Constant defined", "Magic number replaced", "Code behavior unchanged"]
                }
            ],
            "medium": [
                {
                    "title": "Build REST API endpoint",
                    "description": "Create a {method} endpoint at /{resource} that {action}. Include error handling and input validation.",
                    "type": "feature",
                    "files": 2,
                    "test_criteria": ["Endpoint responds to {method}", "Returns correct status codes", "Input validation works", "Error handling present"]
                },
                {
                    "title": "Add caching layer",
                    "description": "Add in-memory caching to {function_name} to avoid redundant {operation} calls. Cache should expire after {timeout}.",
                    "type": "optimization",
                    "files": 2,
                    "test_criteria": ["Cache implemented", "Cache hits work", "Cache expiration works", "Performance improved"]
                },
                {
                    "title": "Refactor to use composition",
                    "description": "Refactor {class_name} to use composition instead of inheritance for {component}.",
                    "type": "refactor",
                    "files": 3,
                    "test_criteria": ["Composition pattern used", "All functionality preserved", "Tests still pass"]
                },
                {
                    "title": "Add database migration",
                    "description": "Create migration to add {field_name} field to {table_name} table. Include rollback migration.",
                    "type": "feature",
                    "files": 2,
                    "test_criteria": ["Migration file created", "Field added correctly", "Rollback works", "Existing data preserved"]
                },
                {
                    "title": "Implement retry logic",
                    "description": "Add exponential backoff retry logic to {function_name} for handling transient {error_type} errors.",
                    "type": "feature",
                    "files": 2,
                    "test_criteria": ["Retry logic implemented", "Exponential backoff works", "Max retries respected", "Success after retry works"]
                }
            ],
            "hard": [
                {
                    "title": "Design event-driven architecture",
                    "description": "Refactor {module_name} to use event-driven architecture with pub/sub pattern. Decouple {component_a} from {component_b}.",
                    "type": "architecture",
                    "files": 5,
                    "test_criteria": ["Event bus implemented", "Components decoupled", "Events published correctly", "Subscribers receive events", "All functionality preserved"]
                },
                {
                    "title": "Add distributed caching",
                    "description": "Implement distributed caching layer using Redis for {service_name}. Include cache invalidation strategy.",
                    "type": "feature",
                    "files": 4,
                    "test_criteria": ["Redis integration works", "Cache invalidation works", "Distributed consistency maintained", "Performance improved"]
                },
                {
                    "title": "Implement rate limiting",
                    "description": "Add token bucket rate limiting to API with {rate} requests per {period}. Include per-user and global limits.",
                    "type": "feature",
                    "files": 4,
                    "test_criteria": ["Rate limiting enforced", "Per-user limits work", "Global limits work", "Rate limit headers present"]
                },
                {
                    "title": "Add observability",
                    "description": "Instrument {service_name} with metrics, tracing, and structured logging. Use OpenTelemetry.",
                    "type": "feature",
                    "files": 6,
                    "test_criteria": ["Metrics exported", "Traces captured", "Structured logs present", "OpenTelemetry configured"]
                },
                {
                    "title": "Migrate to microservices",
                    "description": "Extract {feature_name} from monolith into separate microservice with its own API and database.",
                    "type": "architecture",
                    "files": 8,
                    "test_criteria": ["Service extracted", "API defined", "Database separated", "Inter-service communication works", "All functionality preserved"]
                }
            ]
        }

    def log(self, msg: str):
        """Print if verbose mode enabled"""
        if self.verbose:
            print(f"[TaskGen] {msg}")

    def fill_template(self, template: Dict[str, Any], difficulty: str) -> Dict[str, Any]:
        """Fill template with random values"""
        # Random values for template substitution
        types = ["string", "integer", "email", "URL", "JSON object"]
        methods = ["GET", "POST", "PUT", "DELETE"]
        resources = ["users", "posts", "comments", "products", "orders"]
        actions = [
            "creates a new record",
            "updates existing record",
            "retrieves data",
            "deletes a record",
            "searches records"
        ]
        operations = ["database query", "API call", "file read", "calculation"]
        error_types = ["network", "timeout", "rate limit", "database"]
        
        # Template variable substitutions
        substitutions = {
            "type": random.choice(types),
            "old_name": "tempData",
            "new_name": "temporaryData",
            "func_name": random.choice(["processData", "handleRequest", "validateInput", "formatOutput"]),
            "number": str(random.choice([100, 500, 1000, 3600])),
            "constant_name": "MAX_RETRIES",
            "method": random.choice(methods),
            "resource": random.choice(resources),
            "action": random.choice(actions),
            "function_name": random.choice(["fetchData", "processRequest", "calculateResult"]),
            "operation": random.choice(operations),
            "timeout": "60 seconds",
            "class_name": "DataProcessor",
            "component": "logger",
            "field_name": "created_at",
            "table_name": random.choice(resources),
            "error_type": random.choice(error_types),
            "module_name": "data_pipeline",
            "component_a": "DataFetcher",
            "component_b": "DataProcessor",
            "service_name": "UserService",
            "rate": "100",
            "period": "minute",
            "feature_name": "authentication"
        }
        
        # Fill in template
        title = template["title"].format(**substitutions)
        description = template["description"].format(**substitutions)
        test_criteria = [
            criterion.format(**substitutions)
            for criterion in template["test_criteria"]
        ]
        
        # Generate unique task ID
        task_id = f"{difficulty}_{random.randint(1000, 9999)}"
        
        return {
            "id": task_id,
            "title": title,
            "description": description,
            "difficulty": difficulty,
            "type": template["type"],
            "files": template["files"],
            "test_criteria": test_criteria,
            "source": "synthetic",
            "created_at": datetime.utcnow().isoformat()
        }

    def fetch_github_issues(self, repo: str, count: int, labels: List[str] = None) -> List[Dict[str, Any]]:
        """Fetch real GitHub issues as tasks"""
        self.log(f"Fetching GitHub issues from {repo}")
        
        try:
            url = f"https://api.github.com/repos/{repo}/issues"
            params = {
                "state": "open",
                "per_page": count,
                "sort": "created",
                "direction": "desc"
            }
            
            if labels:
                params["labels"] = ",".join(labels)
            
            response = requests.get(url, params=params, timeout=10)
            response.raise_for_status()
            
            issues = response.json()
            tasks = []
            
            for issue in issues[:count]:
                # Infer difficulty from labels
                difficulty = "medium"
                if any(label["name"].lower() in ["easy", "good first issue", "beginner"] for label in issue.get("labels", [])):
                    difficulty = "easy"
                elif any(label["name"].lower() in ["hard", "complex", "advanced"] for label in issue.get("labels", [])):
                    difficulty = "hard"
                
                # Infer type from labels
                task_type = "bug_fix"
                if any(label["name"].lower() in ["enhancement", "feature"] for label in issue.get("labels", [])):
                    task_type = "feature"
                elif any(label["name"].lower() in ["refactor", "cleanup"] for label in issue.get("labels", [])):
                    task_type = "refactor"
                
                task = {
                    "id": f"github_{issue['number']}",
                    "title": issue["title"],
                    "description": issue["body"] or issue["title"],
                    "difficulty": difficulty,
                    "type": task_type,
                    "files": 2,  # Estimate
                    "test_criteria": [
                        "Issue requirements met",
                        "Code works as expected",
                        "No regressions introduced"
                    ],
                    "source": "github",
                    "github_url": issue["html_url"],
                    "created_at": issue["created_at"]
                }
                
                tasks.append(task)
                self.log(f"  Added: {task['title']}")
            
            return tasks
            
        except Exception as e:
            self.log(f"Failed to fetch GitHub issues: {e}")
            return []

    def generate_synthetic_tasks(self, count: int, difficulty: str) -> List[Dict[str, Any]]:
        """Generate synthetic coding tasks"""
        self.log(f"Generating {count} synthetic {difficulty} tasks")
        
        templates = self.templates.get(difficulty, self.templates["medium"])
        tasks = []
        
        for i in range(count):
            template = random.choice(templates)
            task = self.fill_template(template, difficulty)
            tasks.append(task)
            self.log(f"  Generated: {task['title']}")
        
        return tasks

    def generate(
        self,
        count: int,
        difficulty: str = "mixed",
        github_repos: List[str] = None,
        github_ratio: float = 0.3
    ) -> List[Dict[str, Any]]:
        """
        Generate a mix of tasks
        
        Args:
            count: Total number of tasks to generate
            difficulty: "easy", "medium", "hard", or "mixed"
            github_repos: List of GitHub repos to pull issues from
            github_ratio: Ratio of GitHub issues vs synthetic (0.0-1.0)
        
        Returns:
            List of task dictionaries
        """
        tasks = []
        
        # Determine difficulty distribution for mixed
        if difficulty == "mixed":
            easy_count = int(count * 0.4)
            medium_count = int(count * 0.4)
            hard_count = count - easy_count - medium_count
            difficulty_counts = [
                ("easy", easy_count),
                ("medium", medium_count),
                ("hard", hard_count)
            ]
        else:
            difficulty_counts = [(difficulty, count)]
        
        # Calculate GitHub vs synthetic split
        github_count = int(count * github_ratio)
        synthetic_count = count - github_count
        
        # Fetch GitHub issues
        if github_repos and github_count > 0:
            issues_per_repo = max(1, github_count // len(github_repos))
            for repo in github_repos:
                github_tasks = self.fetch_github_issues(repo, issues_per_repo)
                tasks.extend(github_tasks)
        
        # Generate synthetic tasks
        tasks_generated = 0
        for diff, diff_count in difficulty_counts:
            # Adjust count if we got GitHub issues
            remaining = diff_count - (len(tasks) - tasks_generated)
            if remaining > 0:
                synthetic_tasks = self.generate_synthetic_tasks(remaining, diff)
                tasks.extend(synthetic_tasks)
                tasks_generated += len(synthetic_tasks)
        
        # Shuffle tasks
        random.shuffle(tasks)
        
        return tasks[:count]


def main():
    """CLI interface"""
    parser = argparse.ArgumentParser(
        description="Generate coding tasks for self-play training"
    )
    parser.add_argument("--count", "-n", type=int, default=10, help="Number of tasks to generate")
    parser.add_argument(
        "--difficulty", "-d",
        choices=["easy", "medium", "hard", "mixed"],
        default="mixed",
        help="Task difficulty level"
    )
    parser.add_argument("--output", "-o", help="Output JSON file (default: stdout)")
    parser.add_argument(
        "--github-repos",
        nargs="+",
        help="GitHub repos to pull issues from (e.g., owner/repo)"
    )
    parser.add_argument(
        "--github-ratio",
        type=float,
        default=0.3,
        help="Ratio of GitHub issues vs synthetic (0.0-1.0)"
    )
    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose output")
    
    args = parser.parse_args()
    
    # Generate tasks
    generator = TaskGenerator(verbose=args.verbose)
    tasks = generator.generate(
        count=args.count,
        difficulty=args.difficulty,
        github_repos=args.github_repos,
        github_ratio=args.github_ratio
    )
    
    # Output
    output_data = {
        "generated_at": datetime.utcnow().isoformat(),
        "count": len(tasks),
        "difficulty": args.difficulty,
        "tasks": tasks
    }
    
    output_json = json.dumps(output_data, indent=2)
    
    if args.output:
        with open(args.output, 'w') as f:
            f.write(output_json)
        print(f"Generated {len(tasks)} tasks → {args.output}")
    else:
        print(output_json)
    
    # Summary
    if args.verbose:
        print("\n" + "=" * 60)
        print("Task Generation Summary")
        print("=" * 60)
        print(f"Total tasks: {len(tasks)}")
        
        by_difficulty = {}
        by_type = {}
        by_source = {}
        
        for task in tasks:
            by_difficulty[task["difficulty"]] = by_difficulty.get(task["difficulty"], 0) + 1
            by_type[task["type"]] = by_type.get(task["type"], 0) + 1
            by_source[task["source"]] = by_source.get(task["source"], 0) + 1
        
        print("\nBy difficulty:")
        for diff, count in sorted(by_difficulty.items()):
            print(f"  {diff}: {count}")
        
        print("\nBy type:")
        for typ, count in sorted(by_type.items()):
            print(f"  {typ}: {count}")
        
        print("\nBy source:")
        for src, count in sorted(by_source.items()):
            print(f"  {src}: {count}")


if __name__ == "__main__":
    main()
