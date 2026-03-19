# Player module - Enhanced with difficulty levels

import random

class Player:
    def __init__(self, symbol):
        self.symbol = symbol
    
    def get_move(self, board):
        raise NotImplementedError

class HumanPlayer(Player):
    def get_move(self, board):
        while True:
            try:
                move = int(input("Enter position (1-9): ")) - 1
                if move in board.get_available_moves():
                    return move
                print("Invalid move. Try again.")
            except ValueError:
                print("Please enter a number.")

class AIPlayer(Player):
    """AI Player with multiple difficulty levels"""
    
    def __init__(self, symbol, difficulty="medium"):
        super().__init__(symbol)
        self.difficulty = difficulty
    
    def get_move(self, board):
        if self.difficulty == "easy":
            return self.easy_move(board)
        elif self.difficulty == "medium":
            return self.medium_move(board)
        else:  # hard
            return self.hard_move(board)
    
    def easy_move(self, board):
        """Random moves - very easy to beat"""
        moves = board.get_available_moves()
        return random.choice(moves)
    
    def medium_move(self, board):
        """50% chance of optimal move, 50% random"""
        if random.random() < 0.5:
            best = self.find_best_move(board, self.symbol)
            if best is not None:
                return best
        return random.choice(board.get_available_moves())
    
    def hard_move(self, board):
        """Unbeatable AI using minimax"""
        return self.minimax(board, self.symbol)[0]
    
    def find_best_move(self, board, symbol):
        """Find winning move or blocking move"""
        opponent = "O" if symbol == "X" else "X"
        
        # Check if AI can win
        for move in board.get_available_moves():
            board.cells[move] = symbol
            if board.check_winner(symbol):
                board.cells[move] = " "
                return move
            board.cells[move] = " "
        
        # Check if opponent can win (to block)
        for move in board.get_available_moves():
            board.cells[move] = opponent
            if board.check_winner(opponent):
                board.cells[move] = " "
                return move
            board.cells[move] = " "
        
        return None
    
    def minimax(self, board, player):
        """Minimax algorithm for unbeatable AI"""
        opponent = "O" if player == "X" else "X"
        available = board.get_available_moves()
        
        if board.check_winner(self.symbol):
            return None, 10
        if board.check_winner(opponent):
            return None, -10
        if not available:
            return None, 0
        
        if player == self.symbol:
            best_score = -float('inf')
            best_move = available[0]
            for move in available:
                board.cells[move] = player
                score = self.minimax(board, opponent)[1]
                board.cells[move] = " "
                if score > best_score:
                    best_score = score
                    best_move = move
            return best_move, best_score
        else:
            best_score = float('inf')
            best_move = available[0]
            for move in available:
                board.cells[move] = player
                score = self.minimax(board, opponent)[1]
                board.cells[move] = " "
                if score < best_score:
                    best_score = score
                    best_move = move
            return best_move, best_score
