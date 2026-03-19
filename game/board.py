# Board module for Tic-Tac-Toe

class Board:
    def __init__(self):
        self.cells = [" " for _ in range(9)]
    
    def print_board(self):
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
    
    def is_full(self):
        return " " not in self.cells
    
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
    
    def get_available_moves(self):
        return [i for i, cell in enumerate(self.cells) if cell == " "]
