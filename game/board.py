# Board module for Tic-Tac-Toe - Enhanced display

class Board:
    def __init__(self):
        self.cells = [" " for _ in range(9)]
        self.winner = None
    
    def print_board(self):
        """Print the game board with nice formatting"""
        print("\n┌───┬───┬───┐")
        for i in range(0, 9, 3):
            row = self.cells[i:i+3]
            symbol = [f" {c} " if c != " " else "   " for c in row]
            print(f"│{symbol[0]}│{symbol[1]}│{symbol[2]}│")
            if i < 6:
                print("├───┼───┼───┤")
        print("└───┴───┴───┘")
        print("  1   2   3 ")
        print("  4   5   6 ")
        print("  7   8   9 ")
    
    def print_simple(self):
        """Simple text board for AI thinking display"""
        print("\n  1 | 2 | 3 ")
        print(f" {self.cells[0]} | {self.cells[1]} | {self.cells[2]} ")
        print(" ---+---+---")
        print(f" {self.cells[3]} | {self.cells[4]} | {self.cells[5]} ")
        print(" ---+---+---")
        print(f" {self.cells[6]} | {self.cells[7]} | {self.cells[8]} ")
        print("  4 | 5 | 6 ")
    
    def make_move(self, position, symbol):
        if 0 <= position <= 8 and self.cells[position] == " ":
            self.cells[position] = symbol
            return True
        return False
    
    def undo_move(self, position):
        if 0 <= position <= 8:
            self.cells[position] = " "
    
    def is_full(self):
        return " " not in self.cells
    
    def is_empty(self):
        return " " not in self.cells[:0]
    
    def check_winner(self, symbol):
        # Rows
        for i in range(0, 9, 3):
            if self.cells[i] == self.cells[i+1] == self.cells[i+2] == symbol:
                return True
        # Columns
        for i in range(3):
            if self.cells[i] == self.cells[i+3] == self.cells[i+6] == symbol:
                return True
        # Diagonals
        if self.cells[0] == self.cells[4] == self.cells[8] == symbol:
            return True
        if self.cells[2] == self.cells[4] == self.cells[6] == symbol:
            return True
        return False
    
    def get_winning_line(self):
        """Return the winning line positions if there's a winner"""
        # Rows
        for i in range(0, 9, 3):
            if self.cells[i] == self.cells[i+1] == self.cells[i+2] != " ":
                return [i, i+1, i+2]
        # Columns
        for i in range(3):
            if self.cells[i] == self.cells[i+3] == self.cells[i+6] != " ":
                return [i, i+3, i+6]
        # Diagonals
        if self.cells[0] == self.cells[4] == self.cells[8] != " ":
            return [0, 4, 8]
        if self.cells[2] == self.cells[4] == self.cells[6] != " ":
            return [2, 4, 6]
        return None
    
    def get_available_moves(self):
        return [i for i, cell in enumerate(self.cells) if cell == " "]
    
    def copy(self):
        """Create a copy of the board"""
        new_board = Board()
        new_board.cells = self.cells.copy()
        return new_board
