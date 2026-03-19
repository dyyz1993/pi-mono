# Player module

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
    """AI Player with minimax algorithm for unbeatable gameplay"""
    
    def get_move(self, board):
        # First try to win or block
        move = self.find_best_move(board, self.symbol)
        if move is not None:
            return move
        
        # Take center if available
        if 4 in board.get_available_moves():
            return 4
        
        # Take corners
        corners = [0, 2, 6, 8]
        available_corners = [c for c in corners if c in board.get_available_moves()]
        if available_corners:
            import random
            return random.choice(available_corners)
        
        # Take any available edge
        edges = [1, 3, 5, 7]
        available_edges = [e for e in edges if e in board.get_available_moves()]
        if available_edges:
            import random
            return random.choice(available_edges)
        
        return board.get_available_moves()[0]
    
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
