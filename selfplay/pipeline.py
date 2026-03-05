#!/usr/bin/env python3
"""
Self-Play Training Pipeline - Full self-improvement loop

Orchestrates task generation, solving, validation, and trajectory collection.

Usage:
    python selfplay_pipeline.py --tasks 20 --difficulty mixed --model qwen3-coder:30b
    python selfplay_pipeline.py --tasks 10 --difficulty easy --output-dir training_data/
"""

import os
import sys
import json
import time
import argparse
from typing import Dict, Any, List
from datetime import datetime
from pathlib import Path

# Import our pipeline components
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from selfplay_taskgen import TaskGenerator
from selfplay_solver import TaskSolver
from selfplay_trajectories import TrajectoryCollector


class SelfPlayPipeline:
    """Complete self-play training pipeline"""

    def __init__(
        self,
        model: str = "qwen3-coder:30b",
        output_dir: str = "/path/to/workspace/training_data",
        verbose: bool = False
    ):
        self.model = model
        self.output_dir = output_dir
        self.verbose = verbose
        
        # Create output directories
        os.makedirs(output_dir, exist_ok=True)
        self.tasks_dir = os.path.join(output_dir, "tasks")
        self.solutions_dir = os.path.join(output_dir, "solutions")
        os.makedirs(self.tasks_dir, exist_ok=True)
        os.makedirs(self.solutions_dir, exist_ok=True)
        
        # Initialize components
        self.task_generator = TaskGenerator(verbose=verbose)
        self.solver = TaskSolver(model=model, verbose=verbose)
        self.collector = TrajectoryCollector(verbose=verbose)

    def log(self, msg: str):
        """Print if verbose mode enabled"""
        if self.verbose:
            print(f"[Pipeline] {msg}")

    def run(
        self,
        num_tasks: int,
        difficulty: str = "mixed",
        github_repos: List[str] = None,
        max_attempts: int = 3
    ) -> Dict[str, Any]:
        """
        Run the full self-play pipeline
        
        Args:
            num_tasks: Number of tasks to generate
            difficulty: Task difficulty level
            github_repos: Optional GitHub repos to pull issues from
            max_attempts: Max attempts per task
        
        Returns:
            Dict with pipeline statistics
        """
        
        start_time = time.time()
        
        results = {
            "num_tasks": num_tasks,
            "difficulty": difficulty,
            "model": self.model,
            "started_at": datetime.utcnow().isoformat(),
            "tasks_generated": 0,
            "tasks_attempted": 0,
            "tasks_solved": 0,
            "solve_rate": 0.0,
            "avg_attempts": 0.0,
            "training_examples": 0,
            "duration_seconds": 0,
            "output_dir": self.output_dir
        }
        
        print("=" * 70)
        print("🚀 SELF-PLAY TRAINING PIPELINE")
        print("=" * 70)
        print(f"Model: {self.model}")
        print(f"Tasks: {num_tasks}")
        print(f"Difficulty: {difficulty}")
        print(f"Output: {self.output_dir}")
        print("=" * 70)
        print()
        
        # Step 1: Generate Tasks
        print("📋 Step 1/4: Generating Tasks...")
        tasks = self.task_generator.generate(
            count=num_tasks,
            difficulty=difficulty,
            github_repos=github_repos
        )
        results["tasks_generated"] = len(tasks)
        
        # Save tasks
        tasks_file = os.path.join(self.tasks_dir, f"tasks_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json")
        with open(tasks_file, 'w') as f:
            json.dump({"tasks": tasks}, f, indent=2)
        
        print(f"  ✓ Generated {len(tasks)} tasks")
        print()
        
        # Step 2: Solve Tasks
        print("🤖 Step 2/4: Solving Tasks...")
        solutions = []
        total_attempts = 0
        
        for i, task in enumerate(tasks, 1):
            print(f"\n  Task {i}/{len(tasks)}: {task['title']}")
            print(f"  Difficulty: {task['difficulty']} | Type: {task['type']}")
            
            # Solve task
            solution = self.solver.solve(task)
            results["tasks_attempted"] += 1
            total_attempts += solution["attempts"]
            
            # Save solution
            solution_file = os.path.join(
                self.solutions_dir,
                f"solution_{task['id']}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
            )
            with open(solution_file, 'w') as f:
                json.dump(solution, f, indent=2)
            
            solutions.append(solution)
            
            # Update stats
            if solution["success"]:
                results["tasks_solved"] += 1
                print(f"  ✓ SOLVED in {solution['attempts']} attempt(s)")
            else:
                print(f"  ✗ FAILED after {solution['attempts']} attempt(s)")
            
            # Cleanup workspace
            if solution.get("workspace"):
                self.solver.cleanup_workspace(solution["workspace"])
        
        # Calculate stats
        if results["tasks_attempted"] > 0:
            results["solve_rate"] = results["tasks_solved"] / results["tasks_attempted"]
            results["avg_attempts"] = total_attempts / results["tasks_attempted"]
        
        print()
        print(f"  ✓ Attempted {results['tasks_attempted']} tasks")
        print(f"  ✓ Solved {results['tasks_solved']} tasks ({results['solve_rate']*100:.1f}%)")
        print(f"  ✓ Avg attempts: {results['avg_attempts']:.2f}")
        print()
        
        # Step 3: Collect Trajectories
        print("📚 Step 3/4: Collecting Training Data...")
        examples = []
        
        for solution in solutions:
            if solution["success"]:
                example = self.collector.extract_training_example(solution)
                if example:
                    examples.append(example)
        
        results["training_examples"] = len(examples)
        
        # Save training data
        if examples:
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            training_file = os.path.join(self.output_dir, f"training_batch_{timestamp}.jsonl")
            self.collector.save_jsonl(examples, training_file)
            print(f"  ✓ Collected {len(examples)} training examples")
            print(f"  ✓ Saved to: {training_file}")
        else:
            print(f"  ⚠ No successful solutions to collect")
        
        print()
        
        # Step 4: Generate Report
        print("📊 Step 4/4: Generating Report...")
        
        results["duration_seconds"] = time.time() - start_time
        results["completed_at"] = datetime.utcnow().isoformat()
        
        # Analyze by difficulty
        results["by_difficulty"] = {}
        for solution in solutions:
            # Extract difficulty from task
            task_id = solution["task_id"]
            task = next((t for t in tasks if t["id"] == task_id), None)
            if task:
                difficulty = task["difficulty"]
                if difficulty not in results["by_difficulty"]:
                    results["by_difficulty"][difficulty] = {
                        "attempted": 0,
                        "solved": 0,
                        "solve_rate": 0.0
                    }
                
                results["by_difficulty"][difficulty]["attempted"] += 1
                if solution["success"]:
                    results["by_difficulty"][difficulty]["solved"] += 1
        
        # Calculate solve rates by difficulty
        for difficulty, stats in results["by_difficulty"].items():
            if stats["attempted"] > 0:
                stats["solve_rate"] = stats["solved"] / stats["attempted"]
        
        # Save report
        report_file = os.path.join(self.output_dir, f"report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json")
        with open(report_file, 'w') as f:
            json.dump(results, f, indent=2)
        
        print(f"  ✓ Report saved to: {report_file}")
        print()
        
        # Print summary
        print("=" * 70)
        print("✅ PIPELINE COMPLETE")
        print("=" * 70)
        print(f"Tasks Solved: {results['tasks_solved']}/{results['tasks_attempted']} ({results['solve_rate']*100:.1f}%)")
        print(f"Training Examples: {results['training_examples']}")
        print(f"Duration: {results['duration_seconds']:.1f} seconds")
        
        if results["by_difficulty"]:
            print("\nSolve Rates by Difficulty:")
            for difficulty, stats in sorted(results["by_difficulty"].items()):
                print(f"  {difficulty}: {stats['solved']}/{stats['attempted']} ({stats['solve_rate']*100:.1f}%)")
        
        print("=" * 70)
        print()
        
        return results


def main():
    """CLI interface"""
    parser = argparse.ArgumentParser(
        description="Self-play training pipeline for Rasputin"
    )
    parser.add_argument("--tasks", "-n", type=int, default=10, help="Number of tasks to generate")
    parser.add_argument(
        "--difficulty", "-d",
        choices=["easy", "medium", "hard", "mixed"],
        default="mixed",
        help="Task difficulty level"
    )
    parser.add_argument("--model", "-m", default="qwen3-coder:30b", help="LLM model")
    parser.add_argument(
        "--github-repos",
        nargs="+",
        help="GitHub repos to pull issues from (e.g., owner/repo)"
    )
    parser.add_argument("--max-attempts", type=int, default=3, help="Max attempts per task")
    parser.add_argument(
        "--output-dir",
        default="/path/to/workspace/training_data",
        help="Output directory"
    )
    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose output")
    
    args = parser.parse_args()
    
    # Run pipeline
    pipeline = SelfPlayPipeline(
        model=args.model,
        output_dir=args.output_dir,
        verbose=args.verbose
    )
    
    results = pipeline.run(
        num_tasks=args.tasks,
        difficulty=args.difficulty,
        github_repos=args.github_repos,
        max_attempts=args.max_attempts
    )
    
    # Exit with success if we got at least some training examples
    sys.exit(0 if results["training_examples"] > 0 else 1)


if __name__ == "__main__":
    main()
