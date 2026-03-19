# Score tracking module

import os
import json

class ScoreBoard:
    def __init__(self, filename="scores.json"):
        self.filename = filename
        self.scores = self.load_scores()
    
    def load_scores(self):
        if os.path.exists(self.filename):
            try:
                with open(self.filename, 'r') as f:
                    return json.load(f)
            except:
                pass
        return {"X": 0, "O": 0, "draws": 0}
    
    def save_scores(self):
        with open(self.filename, 'w') as f:
            json.dump(self.scores, f)
    
    def add_win(self, symbol):
        self.scores[symbol] = self.scores.get(symbol, 0) + 1
        self.save_scores()
    
    def add_draw(self):
        self.scores["draws"] = self.scores.get("draws", 0) + 1
        self.save_scores()
    
    def print_scores(self):
        print("\n=== Score Board ===")
        print(f"Player X: {self.scores.get('X', 0)}")
        print(f"Player O: {self.scores.get('O', 0)}")
        print(f"Draws: {self.scores.get('draws', 0)}")
    
    def reset(self):
        self.scores = {"X": 0, "O": 0, "draws": 0}
        self.save_scores()
        print("Scores reset!")
