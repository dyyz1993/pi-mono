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
    def get_move(self, board):
        import random
        moves = board.get_available_moves()
        return random.choice(moves)
